import { loadConfig, log, SearchClient } from "core";

const config = loadConfig();
const search = new SearchClient(config.opensearchEndpoint, config.awsRegion);
const testIndexName = `${config.opensearchIndex}-access-check-${Date.now()}`;

let created = false;

try {
	log.info("Checking OpenSearch index permissions", {
		endpoint: config.opensearchEndpoint,
		region: config.awsRegion,
		testIndexName,
	});

	await search.createIndex(testIndexName, {});
	created = true;

	const exists = await search.indexExists(testIndexName);
	if (!exists) {
		throw new Error(
			`Index ${testIndexName} was created but cannot be found afterwards`,
		);
	}

	log.info("OpenSearch check passed: index create/list permissions are working");
} catch (error) {
	log.error("OpenSearch check failed", error);
	process.exit(1);
} finally {
	if (created) {
		try {
			await search.deleteIndex(testIndexName);
			log.info("Cleanup complete: test index removed");
		} catch (cleanupError) {
			log.warn("Cleanup warning: could not delete test index", cleanupError);
		}
	}
}
