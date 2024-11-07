"use client";

import { ImageGenerationResult } from "@/components/ImageGenerationResult";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateImage } from "@/server/generate";
import { useEffect, useState } from "react";
import { Card } from "./ui/card";
import { WandSparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";
import { useDebounce } from "use-debounce";
import { cn } from "@/lib/utils";

export function App() {
    const [prompt, setPrompt] = useState("beautiful scenery nature glass bottle landscape, purple galaxy bottle");
    const [debouncedPrompt] = useDebounce(prompt, 200);
    const [isGenerating, setIsGenerating] = useState(false);
    const [runId, setRunId] = useState<string | null>(null);

    const handleGenerate = async () => {
		setIsGenerating(true);
	
		try {
			const generatedRunId = await generateImage(prompt);
			if (generatedRunId === "504-ignored") {
				console.warn("504 Gateway Timeout ignorado.");
			} else if (generatedRunId) {
				toast.success("Image generation started!");
				setRunId(generatedRunId);
				mutate("userRuns"); // Actualiza la lista de imágenes generadas
			} else {
				toast.error("Failed to start image generation.");
			}
		} catch (error) {
			const err = error as Error; // Asegura que `error` sea tratado como `Error`
			if (err.message.includes("504")) {
				console.warn("504 Gateway Timeout ignorado.");
			} else {
				console.error("Error generating image:", err);
				toast.error("An error occurred while generating the image.");
			}
		} finally {
			setIsGenerating(false);
		}
	};	

    useEffect(() => {
        if (runId) {
            const interval = setInterval(async () => {
                const response = await fetch(`/api/status/${runId}`);
                const result = await response.json();

                if (result.image_url) {
                    mutate("userRuns");
                    clearInterval(interval); // Detén el polling cuando la imagen esté disponible
                }
            }, 5000);

            return () => clearInterval(interval);
        }
    }, [runId]);

    return (
        <div className="fixed z-50 bottom-0 md:bottom-2 flex flex-col gap-2 w-full md:max-w-lg mx-auto">
            <Card className="p-2 shadow-lg rounded-none md:rounded-2xl">
                <div className="flex gap-2">
                    <Input
                        id="input"
                        className="rounded-xl text-base sm:text-sm z-10"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Enter a prompt to generate an image"
                    />
                    <Button
                        variant="expandIcon"
                        className={cn("rounded-xl transition-all w-[170px] min-w-0 p-0", isGenerating && "opacity-50 cursor-not-allowed")}
                        Icon={WandSparklesIcon}
                        iconPlacement="right"
                        onClick={handleGenerate}
                        disabled={isGenerating}
                    >
                        {isGenerating ? "Generating..." : "Generate"}
                    </Button>
                </div>
            </Card>
        </div>
    );
}
