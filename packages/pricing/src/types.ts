export interface ModelPrice {
    id?: string;
    name?: string;
    input: number;
    output: number;
    cached?: number;
    reasoning?: number;
    cache_creation?: number;
}

export type ProviderModelMap = Record<string, ModelPrice[]>;

export interface RawPricingDataset {
    version?: string;
    updatedAt?: string;
    defaults: ModelPrice;
    models: ProviderModelMap | Record<string, ModelPrice>;
    aliases: Record<string, string>;
}

export interface PricingDataset {
    version?: string;
    updatedAt?: string;
    defaults: ModelPrice;
    models: Record<string, ModelPrice>;
    providerModels?: ProviderModelMap;
    aliases: Record<string, string>;
}

export interface ModelsDevModel {
    id: string;
    name: string;
    description?: string;
    family?: string;
    attachment?: boolean;
    reasoning?: boolean;
    tool_call?: boolean;
    temperature?: boolean;
    knowledge?: string;
    release_date?: string;
    last_updated?: string;
    modalities?: {
        input?: string[];
        output?: string[];
    };
    open_weights?: boolean;
    limit?: {
        context?: number;
        output?: number;
    };
    weights?: Array<{ label: string; url: string }>;
    benchmarks?: Array<{
        name: string;
        score: number;
        metric?: string;
        harness?: string;
        source?: string;
        date?: string;
    }>;
}
