/** OTLP export protocols a tenant can configure for trace export. */
export const OTLP_PROTOCOLS = ['grpc', 'http/protobuf', 'http/json'] as const;
export type OtlpProtocol = (typeof OTLP_PROTOCOLS)[number];
