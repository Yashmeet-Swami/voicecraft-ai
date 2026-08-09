import { setupMeetingsSchema } from '../actions/setup-db';

async function main() {
    const result = await setupMeetingsSchema();
    if (!result.success) {
        console.error(result.message);
        process.exit(1);
    }
    console.log(result.message);
}

main();
