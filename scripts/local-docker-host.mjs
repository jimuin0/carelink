// 並行性検査の --local-docker-shadow / --local-docker 経路で使う Docker ソケットの確認。
// 個人環境のパスを既定値にしない（別の実機で動かなくなるため）。専用ソケットは
// CARELINK_LOCAL_DOCKER_HOST=unix:///<絶対パス>.sock で明示させ、DOCKER_HOST と完全一致
// したときだけ通す。未設定・不一致・共有の既定ソケットは止める（安全ガードは弱めない）。
export const LOCAL_DOCKER_HOST_ENV = 'CARELINK_LOCAL_DOCKER_HOST';

export function dedicatedDockerHostProblem(env) {
  const declared = env.CARELINK_LOCAL_DOCKER_HOST || '';
  if (!/^unix:\/\/\/[^\s]+\.sock$/.test(declared) || declared.split('/').includes('..')) {
    return `${LOCAL_DOCKER_HOST_ENV}=unix:///<absolute path to the dedicated docker.sock> is required`;
  }
  // 普段使いの Docker（他の作業と共有されるソケット）は専用とみなさない。
  const shared = ['unix:///var/run/docker.sock', 'unix:///run/docker.sock'];
  if (env.HOME) shared.push(`unix://${env.HOME}/.docker/run/docker.sock`, `unix://${env.HOME}/.colima/default/docker.sock`);
  if (shared.includes(declared)) return `${LOCAL_DOCKER_HOST_ENV} must not be a shared default Docker socket`;
  if (env.DOCKER_HOST !== declared) return `DOCKER_HOST must equal ${LOCAL_DOCKER_HOST_ENV}`;
  return null;
}

export function requireDedicatedDockerHost(env = process.env) {
  const problem = dedicatedDockerHostProblem(env);
  if (problem) throw new Error(`dedicated local Docker socket required: ${problem}`);
  return env.DOCKER_HOST;
}
