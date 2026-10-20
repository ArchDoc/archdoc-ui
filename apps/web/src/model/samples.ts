import type { Model } from "@archdoc/core/browser";

export interface SampleFile {
  path: string;
  text: string;
}

/**
 * The samples for this model: any in a samples/ directory, and the
 * <journey>.sample.json files named after one of its journeys (a folder of
 * single-file models keeps each model's samples next to it).
 */
export function samplesFor(model: Model, samples: SampleFile[]): SampleFile[] {
  return samples.filter((s) => {
    if (/(^|\/)samples\//.test(s.path)) return true;
    const name = s.path.split("/").pop() ?? "";
    return [...model.journeys.keys()].some((j) => name.startsWith(`${j}.`));
  });
}

/** A sample's records, or undefined when its file isn't an object of records. */
export function parseSample(s: SampleFile): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(s.text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The sample whose file is named after a journey, such as samples/order-to-cash.json. */
export function matchingSample(samples: SampleFile[], journey: string): SampleFile | undefined {
  return samples.find(
    (x) => (x.path.split("/").pop() ?? "").startsWith(journey) && parseSample(x) !== undefined,
  );
}

/** A sample's short name: its file name without .json or .sample.json. */
export function sampleName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/(\.sample)?\.json$/, "");
}
