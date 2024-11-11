"use server";

import { db } from "@/db/db";
import { runs } from "@/db/schema";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";

// Función para optimizar el prompt usando Make
async function promptOptimizer(prompt: string): Promise<string> {
    console.log("Optimizing prompt with assistant...");

    try {
        const response = await fetch("https://hook.us2.make.com/rdpyblg9ov0hrjcqhsktc8l7o6gmiwsc", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ prompt })
        });

        if (!response.ok) {
            console.error(`Failed to optimize prompt: ${response.statusText}`);
            return prompt; // Retornamos el prompt original si falla la solicitud
        }

        const result = await response.json();
        console.log("Respuesta completa de Make:", result);

        const optimizedPrompt = result?.choices?.[0]?.content;
        if (optimizedPrompt) {
            console.log("Optimized prompt:", optimizedPrompt);
            return optimizedPrompt;
        } else {
            console.warn("Content no encontrado en la respuesta de Make. Usando prompt original.");
            return prompt;
        }
    } catch (error: any) {
        console.error("Error optimizing the prompt:", error.message || error);
        return prompt;
    }
}

// Función auxiliar para pausar entre reintentos
function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Función para generar la imagen con reintentos y timeout de 30 segundos
export async function generateImage(prompt: string, retries = 3, delayBetweenRetries = 5000): Promise<string | undefined> {
    console.log("Iniciando generación de imagen con prompt:", prompt);

    const { userId } = auth();
    if (!userId) {
        console.error("Error: Usuario no autenticado");
        throw new Error("User not found");
    }

    const headersList = await headers();
    const host = headersList.get("host") || "";
    const endpoint = `https://${host}`;

    const optimizedPrompt = await promptOptimizer(prompt);
    const inputs: Record<string, string> = {
        input_text: optimizedPrompt,
        batch: "1",
        width: "832",
        height: "1216",
        id: ""
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // Timeout de 30 segundos

        try {
            const response = await fetch("https://www.comfydeploy.com/api/run", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.COMFY_DEPLOY_API_KEY}`
                },
                body: JSON.stringify({
                    deployment_id: process.env.COMFY_DEPLOY_WF_DEPLOYMENT_ID,
                    inputs: inputs,
                    webhook: `${endpoint}/api/webhook`
                }),
                signal: controller.signal // Asigna el controlador de abortos
            });

            clearTimeout(timeoutId); // Limpia el timeout si la respuesta llega a tiempo

            if (response.status === 504) {
                console.warn(`504 Gateway Timeout en intento ${attempt}. Reintentando...`);
                await delay(delayBetweenRetries);
                continue; // Reintenta si el servidor devuelve 504
            }

            const result = await response.json();
            console.log("Resultado de la llamada a ComfyDeploy:", result);

            if (response.ok && result && typeof result === "object" && "run_id" in result) {
                await db.insert(runs).values({
                    run_id: result.run_id,
                    user_id: userId,
                    inputs: inputs
                });

                console.log(`Imagen generada con run_id: ${result.run_id}`);
                return result.run_id;
            } else {
                console.error("Error: No se recibió un resultado de generación válido o el estado de la respuesta es incorrecto.");
                throw new Error("Image generation failed: Invalid response");
            }
        } catch (error: any) {
            clearTimeout(timeoutId); // Limpia el timeout si ocurre un error

            if (error.name === "AbortError") {
                console.error(`Error: La solicitud fue cancelada por tiempo de espera en el intento ${attempt}. Reintentando...`);
            } else {
                console.error(`Error al llamar a la API de ComfyDeploy en el intento ${attempt}:`, error.message || error);
            }

            if (attempt < retries) {
                console.log(`Esperando ${delayBetweenRetries / 1000} segundos antes de reintentar...`);
                await delay(delayBetweenRetries); // Espera antes de reintentar
            } else {
                console.error("Se agotaron los reintentos. No se pudo generar la imagen.");
                throw new Error("Error generating image after multiple attempts");
            }
        }
    }
}
