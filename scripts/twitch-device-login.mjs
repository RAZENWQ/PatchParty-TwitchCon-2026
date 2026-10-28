#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { authorizeTwitchChat, TwitchLoginError, validateChannel, validateClientId, writeEnvConfig } from '../src/twitch-device-auth.mjs';

function argumentsFrom(argv) {
  const result = {};
  for (const argument of argv) {
    const match = /^--(client-id|channel)=(.*)$/.exec(argument);
    if (!match) throw new TwitchLoginError('invalid-argument', `Unknown argument: ${argument}`);
    result[match[1] === 'client-id' ? 'clientId' : 'channel'] = match[2];
  }
  if (!result.clientId) throw new TwitchLoginError('missing-client-id', 'Usage: npm run twitch:login -- --client-id=YOUR_CLIENT_ID [--channel=channel_login]');
  result.clientId = validateClientId(result.clientId);
  result.channel = validateChannel(result.channel);
  return result;
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const config = await authorizeTwitchChat({ ...options, signal: controller.signal,
      onActivation({ verificationUri, userCode, expiresIn }) {
        console.log('\nOn your phone, open this verified Twitch address:');
        console.log(verificationUri);
        console.log(`Confirm code: ${userCode}`);
        console.log(`This code expires in about ${Math.ceil(expiresIn / 60)} minutes. Waiting for approval (Ctrl+C to cancel)...\n`);
      }
    });
    const prompt = createInterface({ input: stdin, output: stdout });
    try {
      const saved = await writeEnvConfig({ config, confirmOverwrite: async () => {
        const answer = await prompt.question('An existing .env was found. Replace only its Twitch settings and preserve all other lines? [y/N] ');
        return /^y(es)?$/i.test(answer.trim());
      }});
      console.log(`Authorization validated and Twitch settings saved to ${saved}.`);
      console.log('The access token was not displayed. Restart the PatchParty server when ready.');
    } finally { prompt.close(); }
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

main().catch(error => {
  const message = error instanceof TwitchLoginError ? error.message : 'Twitch login failed unexpectedly.';
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
