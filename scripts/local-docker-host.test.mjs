import test from 'node:test';
import assert from 'node:assert/strict';
import { dedicatedDockerHostProblem, requireDedicatedDockerHost } from './local-docker-host.mjs';

const sock = 'unix:///opt/carelink-shadow/docker.sock';

test('明示した専用ソケットと DOCKER_HOST が一致したときだけ通す', () => {
  assert.equal(dedicatedDockerHostProblem({ CARELINK_LOCAL_DOCKER_HOST: sock, DOCKER_HOST: sock }), null);
  assert.equal(requireDedicatedDockerHost({ CARELINK_LOCAL_DOCKER_HOST: sock, DOCKER_HOST: sock }), sock);
});

test('未設定・形式不正・不一致・共有の既定ソケットは止める', () => {
  const home = '/home/someone';
  for (const env of [
    {}, { DOCKER_HOST: sock },
    { CARELINK_LOCAL_DOCKER_HOST: 'tcp://production.invalid:2375', DOCKER_HOST: 'tcp://production.invalid:2375' },
    { CARELINK_LOCAL_DOCKER_HOST: 'unix://relative/docker.sock', DOCKER_HOST: 'unix://relative/docker.sock' },
    { CARELINK_LOCAL_DOCKER_HOST: 'unix:///opt/../var/run/docker.sock', DOCKER_HOST: 'unix:///opt/../var/run/docker.sock' },
    { CARELINK_LOCAL_DOCKER_HOST: sock, DOCKER_HOST: 'unix:///other/docker.sock' },
    { CARELINK_LOCAL_DOCKER_HOST: 'unix:///var/run/docker.sock', DOCKER_HOST: 'unix:///var/run/docker.sock' },
    { HOME: home, CARELINK_LOCAL_DOCKER_HOST: `unix://${home}/.docker/run/docker.sock`, DOCKER_HOST: `unix://${home}/.docker/run/docker.sock` },
  ]) {
    assert.notEqual(dedicatedDockerHostProblem(env), null, JSON.stringify(env));
    assert.throws(() => requireDedicatedDockerHost(env), /dedicated local Docker socket required/);
  }
});
