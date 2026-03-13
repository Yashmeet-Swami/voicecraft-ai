import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function testCurrentEmbeddingModel() {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        const models = data.models || [];
        const embedModels = models.map((m: any) => m.name).filter((n: string) => n.includes("embed"));
        console.log("Available Embedding Models:");
        console.log(embedModels);
    } catch (e) {
        console.error("Fetch threw error:", e);
    }
}

testCurrentEmbeddingModel();
