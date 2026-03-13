import { ingestTextDocument, retrieveContext } from '../actions/knowledge-actions';

async function testRAG() {
    console.log("Starting RAG Pipeline Test...");

    const sampleDoc = `
VoiceCraftAI is an innovative tool designed to transform spoken words into polished blog posts. 
By utilizing advanced speech-to-text models like Gemini Flash 2.0, it ensures high transcription accuracy even with heavy background noise. 
The core philosophy of VoiceCraftAI is to eliminate the friction between having an idea and publishing it to the world.

Architecture-wise, VoiceCraftAI leverages a Next.js frontend coupled with server actions for seamless API integration. 
For the database, it uses NeonDB SERVERLESS PostgreSQL, which scales automatically with demand.
Recently, the platform was upgraded to support Retrieval-Augmented Generation (RAG). 
This allows the system to ingest custom knowledge bases so that the generated blogs can reference specific facts, figures, or company terminology that the base LLM might not know.
  `;

    console.log("1. Testing Ingestion...");
    const ingestResp = await ingestTextDocument("VoiceCraftAI Architecture Overview", sampleDoc.trim());
    console.log("Ingestion Response:", ingestResp);

    if (!ingestResp.success) {
        console.error("Ingestion failed. Aborting test.");
        process.exit(1);
    }

    console.log("\n2. Testing Retrieval...");
    const query = "What database does VoiceCraftAI use and what are its features?";
    console.log("Query:", query);

    const contextText = await retrieveContext(query, 2);
    console.log("\n--- Retrieved Context ---\n", contextText);

    if (contextText.includes("NeonDB")) {
        console.log("\n✅ Test Passed: Successfully retrieved relevant context!");
    } else {
        console.error("\n❌ Test Failed: Could not retrieve expected context.");
    }
}

testRAG().catch(console.error);
