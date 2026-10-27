import type { HttpClient } from '../http.js';
import type { ApiResponse, EngagementGate, EngagementGateDelivery, CreateGateInput } from '../types.js';

export class EngagementGatesResource {
  constructor(private readonly http: HttpClient) {}

  /** @deprecated Use campaigns.create() for the LINE-first flow. */
  async create(input: CreateGateInput): Promise<EngagementGate> {
    const res = await this.http.post<ApiResponse<EngagementGate>>('/api/engagement-gates', input);
    return res.data;
  }

  async list(): Promise<EngagementGate[]> {
    const res = await this.http.get<ApiResponse<EngagementGate[]>>('/api/engagement-gates');
    return res.data;
  }

  async get(id: string): Promise<EngagementGate> {
    const res = await this.http.get<ApiResponse<EngagementGate>>(`/api/engagement-gates/${id}`);
    return res.data;
  }

  async update(id: string, input: Partial<CreateGateInput & { isActive: boolean }>): Promise<EngagementGate> {
    const res = await this.http.put<ApiResponse<EngagementGate>>(`/api/engagement-gates/${id}`, input);
    return res.data;
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/engagement-gates/${id}`);
  }

  async getDeliveries(id: string, params?: { limit?: number; offset?: number }): Promise<EngagementGateDelivery[]> {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const query = qs.toString();
    const res = await this.http.get<ApiResponse<EngagementGateDelivery[]>>(`/api/engagement-gates/${id}/deliveries${query ? '?' + query : ''}`);
    return res.data;
  }
}
