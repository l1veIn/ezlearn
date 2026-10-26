import { API_VERSION, AppError } from '../contracts/index.js';
import { normalizeEndpoint } from './config.js';

/** The sole learning transport for every platform endpoint. Never imports core or storage. */
export class PlatformClient {
  readonly endpoint: string;
  private verified = false;
  constructor(
    endpoint: string,
    private token?: string,
  ) {
    this.endpoint = normalizeEndpoint(endpoint);
  }
  private async request(path: string, input?: unknown, authenticate = true): Promise<any> {
    let response: Response;
    try {
      response = await fetch(`${this.endpoint}${path}`, {
        ...(input === undefined ? {} : { method: 'POST', body: JSON.stringify(input) }),
        headers: {
          ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(authenticate && this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });
    } catch {
      throw new AppError(
        'PLATFORM_UNREACHABLE',
        `无法连接平台 ${this.endpoint}。本机实例请先运行 ezlearn platform start；其他实例请检查 endpoint 与网络。`,
        503,
        { endpoint: this.endpoint, start_command: 'pnpm ezlearn platform start' },
      );
    }
    let result: any;
    try {
      result = await response.json();
    } catch {
      throw new AppError(
        'BACKEND_ERROR',
        `平台返回非 JSON 响应（HTTP ${response.status}），请检查 endpoint`,
        502,
      );
    }
    if (!response.ok || result?.ok === false)
      throw new AppError(
        result?.error?.code || 'BACKEND_ERROR',
        result?.error?.message || `平台请求失败（HTTP ${response.status}）`,
        response.status,
        result?.error?.details,
      );
    if (!result || result.ok !== true)
      throw new AppError('INVALID_RESPONSE', '端点没有返回有效的 ezlearn 响应', 502);
    return result.data === undefined ? result : result.data;
  }
  async health() {
    const health = await this.request('/health', undefined, false);
    if (health.product !== 'ezlearn' || health.api_version !== API_VERSION)
      throw new AppError(
        'INCOMPATIBLE_API',
        `端点不是兼容的 ezlearn 平台（需要 API v${API_VERSION}）；请更新或重启平台`,
        409,
      );
    this.verified = true;
    return health;
  }
  async call(operation: string, input: Record<string, unknown> = {}) {
    if (!this.verified) await this.health();
    return this.request(`/api/rpc/${encodeURIComponent(operation)}`, input);
  }
  async installGithub(repository: string, ref: string, validateOnly = false) {
    if (!this.verified) await this.health();
    return this.request('/api/packs/github', { repository, ref, validate_only: validateOnly });
  }
  async metadata() {
    if (!this.verified) await this.health();
    return this.request('/api/platform');
  }
}
