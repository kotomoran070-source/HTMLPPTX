// yarn firewall — один раз разрешить пульт с телефона в брандмауэре Windows (см. plugins/firewall.mjs)
import { ensureFirewall, firewallMessage, PORTS, RULE } from '../plugins/firewall.mjs';

if (process.platform !== 'win32') {
  console.log('Брандмауэр настраивается только в Windows — здесь ничего делать не нужно.');
  process.exit(0);
}
const state = await ensureFirewall();
if (state === 'ok') console.log(`Уже настроено: правило «${RULE}» (порты ${PORTS}, локальная сеть), запретов для Node нет.`);
else console.log(firewallMessage(state).trim() || 'Готово.');
process.exit(state === 'ok' || state === 'fixed' ? 0 : 1);
