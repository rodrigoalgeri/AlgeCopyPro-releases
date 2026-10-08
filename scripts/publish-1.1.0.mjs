import { readFileSync, appendFileSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const repository = 'rodrigoalgeri/AlgeCopyPro-releases';
const version = '1.1.0';
const tag = 'v1.1.0';
const filename = 'AlgeCopyPro-1.1.0-Windows-x64-Setup.exe';
const expectedSha = '5b50d0c552c420fe93149a8a28d25fdbd414f5f27ae4694905cbb17083d90ed4';
const publicKey = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDIzQ0UwNzE5NDNCNUZEQTcKUldTbi9iVkRHUWZPSS9qNFg0Z2lFNVl2bFhOb1I5U3RpT3k5SUVOYUlraW81QlZvb2xHdDZld0kK';
const base = process.env.ALGE_PACKAGE;
if (!base) throw Error('Pasta do pacote ausente.');
if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== repository) throw Error('Repositório inesperado.');

const data = readFileSync(join(base, filename));
const manifestText = readFileSync(join(base, 'latest.json'), 'utf8');
const manifest = JSON.parse(manifestText);
const signature = readFileSync(join(base, filename + '.sig'), 'utf8').trim();
const expectedUrl = 'https://github.com/' + repository + '/releases/download/' + tag + '/' + filename;
const platform = manifest.platforms?.['windows-x86_64'];
if (manifest.version !== version || platform?.url !== expectedUrl || platform.signature !== signature) throw Error('Manifesto incompatível.');
if (createHash('sha256').update(data).digest('hex') !== expectedSha) throw Error('SHA-256 incorreto.');
if (readFileSync(join(base, filename + '.sha256'), 'utf8').split(/\s/)[0] !== expectedSha) throw Error('Arquivo SHA-256 incompatível.');

const lines = Buffer.from(signature, 'base64').toString('utf8').trim().split(/\r?\n/);
const rawSignature = Buffer.from(lines[1], 'base64');
const rawKey = Buffer.from(Buffer.from(publicKey, 'base64').toString('utf8').trim().split(/\r?\n/)[1], 'base64');
if (rawSignature.length !== 74 || rawKey.length !== 42 || !rawSignature.subarray(2, 10).equals(rawKey.subarray(2, 10))) throw Error('Chave da assinatura incompatível.');
const key = createPublicKey({key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey.subarray(10)]), format:'der', type:'spki'});
const payload = rawSignature.subarray(0, 2).toString() === 'ED' ? createHash('blake2b512').update(data).digest() : data;
if (!verify(null, payload, key, rawSignature.subarray(10))) throw Error('Assinatura do instalador inválida.');
const comment = lines[2].replace(/^trusted comment: /, '');
if (!verify(null, Buffer.concat([rawSignature.subarray(10), Buffer.from(comment)]), key, Buffer.from(lines[3], 'base64'))) throw Error('Comentário da assinatura inválido.');
console.log('Pacote 1.1.0, SHA-256, assinatura e chave pública validados.');

if (process.argv.includes('--validate-only')) process.exit(0);

function gh(args, input) {
  const result = spawnSync('gh', args, {encoding: 'utf8', input, env: process.env, maxBuffer: 10 * 1024 * 1024});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr || 'Falha na API GitHub.');
  return result.stdout;
}
function api(path, payload) {
  return JSON.parse(gh(['api', path, ...(payload ? ['--method', 'PUT', '--input', '-'] : [])], payload ? JSON.stringify(payload) : undefined));
}
const remoteFile = api('repos/' + repository + '/contents/latest.json?ref=main');
const currentManifest = JSON.parse(Buffer.from(remoteFile.content, 'base64').toString('utf8'));
if (!['1.0.1', version].includes(currentManifest.version)) throw Error('O manifesto público mudou. Rever publicação antes de continuar.');

let release;
try {
  release = api('repos/' + repository + '/releases/tags/' + tag);
} catch (error) {
  if (!String(error.message).includes('404')) throw error;
}
if (!release) {
  gh(['release', 'create', tag, '--repo', repository, '--target', 'main', '--draft',
      '--title', 'AlgeCopy Pro 1.1.0 — Seu histórico no ritmo do teclado',
      '--notes-file', join(base, 'release-notes.md')]);
  release = api('repos/' + repository + '/releases/tags/' + tag);
}
if (release.draft) {
  gh(['release', 'upload', tag, '--repo', repository, '--clobber',
      join(base, filename), join(base, filename + '.sig'), join(base, filename + '.sha256')]);
  const uploaded = api('repos/' + repository + '/releases/tags/' + tag);
  for (const [name, size] of [[filename, data.length], [filename + '.sig', readFileSync(join(base, filename + '.sig')).length],
                            [filename + '.sha256', readFileSync(join(base, filename + '.sha256')).length]]) {
    if (!uploaded.assets.some(asset => asset.name === name && asset.size === size && asset.state === 'uploaded')) throw Error('Asset incompleto: ' + name);
  }
  gh(['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest']);
}
let publicHash;
for (let attempt = 0; attempt < 15; attempt++) {
  try {
    const response = await fetch(expectedUrl);
    if (!response.ok) throw Error('Download público HTTP ' + response.status);
    publicHash = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
    break;
  } catch (error) {
    if (attempt === 14) throw error;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
if (publicHash !== expectedSha) throw Error('O instalador público difere do pacote assinado. Manifesto não alterado.');
const finalFile = api('repos/' + repository + '/contents/latest.json?ref=main');
const finalManifest = JSON.parse(Buffer.from(finalFile.content, 'base64').toString('utf8'));
if (!['1.0.1', version].includes(finalManifest.version)) throw Error('Outra versão foi anunciada durante a publicação.');
if (finalManifest.version !== version || finalManifest.platforms?.['windows-x86_64']?.signature !== signature) {
  api('repos/' + repository + '/contents/latest.json', {
    branch: 'main',
    message: 'Anuncia atualização assinada AlgeCopy Pro 1.1.0 com Modo Vim',
    sha: finalFile.sha,
    content: Buffer.from(manifestText).toString('base64'),
  });
}
const finalCheck = api('repos/' + repository + '/contents/latest.json?ref=main');
const announced = JSON.parse(Buffer.from(finalCheck.content, 'base64').toString('utf8'));
if (announced.version !== version || announced.platforms['windows-x86_64'].signature !== signature) throw Error('Manifesto final não confere.');
console.log('Release pública e manifesto 1.1.0 verificados.');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## AlgeCopy Pro 1.1.0 publicado\n\nInstalador assinado validado e disponível publicamente. Manifesto de atualização confirmado.\n\nhttps://github.com/' + repository + '/releases/tag/' + tag + '\n');
