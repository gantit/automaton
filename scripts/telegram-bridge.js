import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const AUTOMATON_DIR = path.join(os.homedir(), '.automaton');
const ENV_PATH = path.join(AUTOMATON_DIR, '.env');

// Cargar credenciales desde el .env
let BOT_TOKEN = '';
let CREATOR_ID = null;

if (fs.existsSync(ENV_PATH)) {
  const envFile = fs.readFileSync(ENV_PATH, 'utf8');
  const tokenMatch = envFile.match(/TELEGRAM_BOT_TOKEN=(.+)/);
  const idMatch = envFile.match(/TELEGRAM_CREATOR_ID=(.+)/);
  if (tokenMatch) BOT_TOKEN = tokenMatch[1].trim();
  if (idMatch) CREATOR_ID = parseInt(idMatch[1].trim(), 10);
}

if (!BOT_TOKEN || !CREATOR_ID) {
  console.error("❌ ERROR [Telegram Bridge]: Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CREATOR_ID.");
  console.error(`Asegúrate de configurar el Automaton (npm run dev) o de proveerlos en ${ENV_PATH}`);
  process.exit(1);
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

let lastUpdate = 0;

async function tg(method, body = {}) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}

async function sendMsg(text) {
  return tg('sendMessage', { chat_id: CREATOR_ID, text });
}

function getStatus() {
  try {
    // Busca la red de base para ver ETH
    const ethHex = JSON.parse(execSync(
      'curl -s -X POST https://base-rpc.publicnode.com -H "Content-Type: application/json" ' +
      '-d \'{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0x2895310Edea4EC660D94F5cc5c94ac572b89E938","latest"]}\''
    ).toString()).result;
    const ethBal = (parseInt(ethHex, 16) / 1e18).toFixed(4);

    // USDC balance (Base)
    const usdcHex = JSON.parse(execSync(
      'curl -s -X POST https://base-rpc.publicnode.com -H "Content-Type: application/json" ' +
      '-d \'{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","data":"0x70a082310000000000000000000000002895310edea4ec660d94f5cc5c94ac572b89e938"},"latest"]}\''
    ).toString()).result;
    const usdcBal = (parseInt(usdcHex, 16) / 1e6).toFixed(2);

    const ps = execSync('ps aux | grep "node dist" | grep -v grep').toString().trim();

    return `Estado de Casandra\n\nETH: ${ethBal} ETH\nUSDC: ${usdcBal} USDC\n\nProceso Principal: ${ps ? 'activo' : 'detenido'}`;
  } catch(e) {
    return `Error obteniendo estado: ${e.message.slice(0, 100)}`;
  }
}


async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || msg.chat.id !== CREATOR_ID) return;

  const text = (msg.text || '').trim();
  console.log('[Telegram] Recibido:', text);

  if (text === '/status') {
    await sendMsg(getStatus());
  } else if (text === '/soul') {
    try {
      const soul = fs.readFileSync(path.join(AUTOMATON_DIR, 'SOUL.md'), 'utf8');
      await sendMsg('SOUL.md:\n\n' + soul.slice(0, 3500));
    } catch(e) { await sendMsg('Error leyendo SOUL.md: ' + e.message); }
  } else if (text === '/help') {
    await sendMsg('Casandra Bot\n\n/status - Saldos y estado\n/soul - Ver SOUL.md\n/help - Ayuda\n\nCualquier otro mensaje se guarda como instruccion del creador.');
  } else if (!text.startsWith('/')) {
    const content = `# CREATOR MESSAGE (Telegram) - ${new Date().toISOString()}\n\n${text}`;
    
    if (!fs.existsSync(AUTOMATON_DIR)) fs.mkdirSync(AUTOMATON_DIR, { recursive: true });
    writeFileSync(path.join(AUTOMATON_DIR, 'CREATOR_MESSAGE.md'), content);
    
    await sendMsg('Instruccion guardada en CREATOR_MESSAGE.md. Automaton la procesará en su próximo tick/heartbeat.');
    console.log('[Telegram] Instrucción guardada en', AUTOMATON_DIR);
  } else {
    await sendMsg('Comando no reconocido. Usa /help');
  }
}

async function poll() {
  try {
    const r = await tg('getUpdates', { offset: lastUpdate + 1, timeout: 30 });
    if (r.ok && r.result.length > 0) {
      for (const u of r.result) {
        lastUpdate = u.update_id;
        await handleUpdate(u);
      }
    }
  } catch(e) {
    console.error('[Telegram] Poll error:', e.message);
  }
  setTimeout(poll, 5000);
}

console.log(`[Telegram Bridge] Iniciando en ${AUTOMATON_DIR}...`);
const startMsg = await sendMsg('Telegram Bridge activo. Soy Casandra (Automaton V2).\n\n/status /soul /help\n\nEnvíame una instrucción y la leeré en mi próximo ciclo.');
console.log('[Telegram Bridge] Inicio:', startMsg.ok ? 'OK' : JSON.stringify(startMsg));
poll();
