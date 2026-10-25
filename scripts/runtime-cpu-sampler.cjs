'use strict';

// Process CPU across a sampled request is diagnostic evidence, not a billable
// CPU metric. Background work can contribute; overlap is explicitly reported.
function requestGroup(method, url) {
  if (method !== 'GET' && method !== 'HEAD') return 'write';
  const path = typeof url === 'string' ? url.split('?', 1)[0] : '';
  if (path === '/search') return 'search';
  if (path === '/api/health') return 'health';
  if (path.startsWith('/api/cron/')) return 'cron';
  if (path.startsWith('/api/')) return 'api';
  if (path.startsWith('/_next/')) return 'asset';
  if (path === '/') return 'home';
  if (path.startsWith('/facility/')) return 'facility';
  return 'other';
}

function attachCpuSampler(server, {
  every = 16,
  cpuUsage = process.cpuUsage,
  uptime = process.uptime,
  now = performance.now.bind(performance),
  emit = (record) => console.info('[runtime-cpu-sample]', JSON.stringify(record)),
} = {}) {
  let active = 0;
  let started = 0;
  let candidate;
  const seen = new Set();
  const round = (value) => Math.round(value * 1000) / 1000;
  server.prependListener('request', (req, res) => {
    started += 1;
    if (candidate) candidate.overlap = true;
    const group = requestGroup(req.method, req.url);
    const first = !seen.has(group);
    seen.add(group);
    // Never inspect or log cookies, headers, bodies, query values, identities,
    // or raw paths. Include all requests in overlap accounting.
    const sample = active === 0 && group !== 'asset' && group !== 'write' &&
      (first || started % every === 0);
    active += 1;
    const initialCpu = sample ? cpuUsage() : undefined;
    const initialTime = sample ? now() : undefined;
    const selected = sample ? { overlap: false } : undefined;
    if (sample) candidate = selected;
    let completed = false;
    const finish = (ended) => {
      if (completed) return;
      completed = true;
      active -= 1;
      if (!sample) return;
      const total = cpuUsage();
      if (candidate === selected) candidate = undefined;
      emit({
        group,
        ended,
        overlap: selected.overlap,
        requests_started: started,
        process_uptime_ms: round(uptime() * 1000),
        wall_ms: round(now() - initialTime),
        cpu_user_ms: round((total.user - initialCpu.user) / 1000),
        cpu_system_ms: round((total.system - initialCpu.system) / 1000),
        process_cpu_before_ms: round((initialCpu.user + initialCpu.system) / 1000),
        process_cpu_after_ms: round((total.user + total.system) / 1000),
      });
    };
    res.once('finish', () => finish('finish'));
    res.once('close', () => finish('close'));
  });
}

module.exports = { requestGroup, attachCpuSampler };
