import { log } from "core";
import type { IntentCentroid } from "./v2/types.ts";
import centroidsJson from "../../../data/intent-centroids.json";

let cached: IntentCentroid[] | null = null;

/** Intent centroids bundled at build time (local + Lambda). */
export function loadIntentCentroids(): IntentCentroid[] {
	if (cached) return cached;
	cached = centroidsJson as IntentCentroid[];
	log.info(`Loaded ${cached.length} intent centroids for V2`);
	return cached;
}
