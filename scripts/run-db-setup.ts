import { setupDatabase } from '../actions/setup-db';

async function main() {
    const result = await setupDatabase();
    if (!result.success) {
        console.error(result.message);
        process.exit(1);
    }
}

main();
