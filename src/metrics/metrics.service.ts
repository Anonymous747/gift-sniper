import { Injectable } from '@nestjs/common';

type LatSample = { sumMs: number; count: number; maxMs: number };

@Injectable()
export class MetricsService {
  private startedAt = Date.now();
  private collectorPolls = 0;
  private collectorPollErrors = 0;
  private eventsPublished = 0;
  private ingestOk = 0;
  private ingestErr = 0;
  private alertsSent = 0;
  private alertsFailed = 0;
  private readonly publishLatency: LatSample = { sumMs: 0, count: 0, maxMs: 0 };
  private readonly ingestLatency: LatSample = { sumMs: 0, count: 0, maxMs: 0 };
  private readonly alertLatency: LatSample = { sumMs: 0, count: 0, maxMs: 0 };

  uptimeSec(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  bumpCollectorPoll(ok: boolean): void {
    this.collectorPolls += 1;
    if (!ok) this.collectorPollErrors += 1;
  }

  recordPublish(durationMs: number): void {
    this.eventsPublished += 1;
    this.pushLat(this.publishLatency, durationMs);
  }

  recordIngest(durationMs: number, ok: boolean): void {
    if (ok) this.ingestOk += 1;
    else this.ingestErr += 1;
    this.pushLat(this.ingestLatency, durationMs);
  }

  recordAlert(durationMs: number, ok: boolean): void {
    if (ok) this.alertsSent += 1;
    else this.alertsFailed += 1;
    this.pushLat(this.alertLatency, durationMs);
  }

  snapshot(): Record<string, unknown> {
    return {
      uptime_sec: this.uptimeSec(),
      collector_polls: this.collectorPolls,
      collector_poll_errors: this.collectorPollErrors,
      events_published: this.eventsPublished,
      ingest_ok: this.ingestOk,
      ingest_err: this.ingestErr,
      alerts_sent: this.alertsSent,
      alerts_failed: this.alertsFailed,
      publish_latency_ms: this.latSummary(this.publishLatency),
      ingest_latency_ms: this.latSummary(this.ingestLatency),
      alert_latency_ms: this.latSummary(this.alertLatency),
    };
  }

  /** Prometheus exposition (subset). */
  prometheusText(): string {
    const lines: string[] = [];
    const g = (name: string, help: string, type: string, val: number) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      lines.push(`${name} ${val}`);
    };
    g('gift_sniper_uptime_seconds', 'Process uptime', 'gauge', this.uptimeSec());
    g('gift_sniper_collector_polls_total', 'MRKT poll iterations', 'counter', this.collectorPolls);
    g('gift_sniper_events_published_total', 'Events published to Redis stream', 'counter', this.eventsPublished);
    g('gift_sniper_ingest_success_total', 'Ingestion successes', 'counter', this.ingestOk);
    g('gift_sniper_ingest_error_total', 'Ingestion errors', 'counter', this.ingestErr);
    g('gift_sniper_alerts_sent_total', 'Telegram alerts sent', 'counter', this.alertsSent);
    g('gift_sniper_alerts_failed_total', 'Telegram alerts failed', 'counter', this.alertsFailed);
    const p = this.publishLatency;
    if (p.count > 0) {
      g('gift_sniper_publish_latency_avg_ms', 'Avg publish latency', 'gauge', p.sumMs / p.count);
      g('gift_sniper_publish_latency_max_ms', 'Max publish latency', 'gauge', p.maxMs);
    }
    const i = this.ingestLatency;
    if (i.count > 0) {
      g('gift_sniper_ingest_latency_avg_ms', 'Avg ingest latency', 'gauge', i.sumMs / i.count);
      g('gift_sniper_ingest_latency_max_ms', 'Max ingest latency', 'gauge', i.maxMs);
    }
    const a = this.alertLatency;
    if (a.count > 0) {
      g('gift_sniper_alert_latency_avg_ms', 'Avg alert send latency', 'gauge', a.sumMs / a.count);
      g('gift_sniper_alert_latency_max_ms', 'Max alert send latency', 'gauge', a.maxMs);
    }
    return lines.join('\n') + '\n';
  }

  private pushLat(s: LatSample, ms: number): void {
    s.sumMs += ms;
    s.count += 1;
    s.maxMs = Math.max(s.maxMs, ms);
  }

  private latSummary(s: LatSample): { avg_ms: number | null; max_ms: number; n: number } {
    if (s.count === 0) return { avg_ms: null, max_ms: s.maxMs, n: 0 };
    return { avg_ms: s.sumMs / s.count, max_ms: s.maxMs, n: s.count };
  }
}
