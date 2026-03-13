import * as dotenv from 'dotenv';
import * as fs from 'fs';
dotenv.config({ path: '.env.local' });

async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await res.json();
        const flashModels = data.models
            .filter((m: any) => m.name.includes("flash") && m.supportedGenerationMethods?.includes('generateContent'))
            .map((m: any) => m.name);

        fs.writeFileSync('flash-models.txt', flashModels.join('\n'));
        console.log("Wrote flash models to flash-models.txt");
    } catch (e) {
        console.error(e);
    }
}

listModels();
