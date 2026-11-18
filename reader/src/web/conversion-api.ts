export type Upload = { id: string; name: string; pages: number; size: number; url?: string };
export type OutputFile = { kind: 's2e' | 'json' | 'html'; name: string; size: number; url: string };
export type ConversionJob = {
  id: string; upload: Upload; status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  model: string; workers: number; pageStart: number; pageEnd: number;
  stage: string; progress: number; message: string; error?: string; files: OutputFile[];
  startedAt?: number; finishedAt?: number | null; current?: number; total?: number; pdfPage?: number;
};
export type StartOptions = { uploadId: string; pageStart: number; pageEnd: number; model: string; workers: number; apiKey: string };
export type Capabilities = { available: boolean; message?: string; jobs: ConversionJob[] };

const API = '/__scan2ebook__/conversion';
export function conversionApi(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(API + path, { cache: 'no-store', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error || '本地转换服务暂时不可用，请稍后重试'), { status: response.status });
    return body;
  }
  const post = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return {
    status: () => request<Capabilities>(''),
    upload: (file: File) => request<Upload>('/uploads', { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-s2e-filename': encodeURIComponent(file.name) }, body: file }),
    uploadInfo: (id: string) => request<Upload>('/uploads/' + encodeURIComponent(id)),
    start: (options: StartOptions) => post<ConversionJob>('/jobs', options),
    job: (id: string) => request<ConversionJob>('/jobs/' + id),
    cancel: (id: string) => post<ConversionJob>('/jobs/' + id + '/cancel', {}),
    remove: (id: string) => request<{ removedJobs: number; removedUploads: number; freedBytes: number }>('/jobs/' + id, { method: 'DELETE' }),
    cleanup: (keepUploadId?: string) => post<{ removedJobs: number; removedUploads: number; freedBytes: number }>('/cleanup', { keepUploadId }),
    async book(file: OutputFile) {
      const response = await fetchImpl(file.url);
      if (!response.ok) throw new Error('电子书下载失败，请重试');
      return new File([await response.blob()], file.name, { type: 'application/zip' });
    },
  };
}

export function notifyTasksChanged(detail: { removedId?: string; cleanup?: boolean } = {}) {
  window.dispatchEvent(new window.CustomEvent('s2e:tasks-changed', { detail }));
}
