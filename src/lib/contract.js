const EVM_REGEX = /\b0x[a-fA-F0-9]{40}\b/gi;
const SOLANA_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const TRON_REGEX = /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g;

function extractContractAddresses(text) {
  const addresses = [];
  const seen = new Set();

  const evmMatches = text.match(EVM_REGEX);
  if (evmMatches) {
    evmMatches.forEach(addr => {
      const lower = addr.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        addresses.push({
          address: lower,
          displayAddress: '0x' + lower.slice(2).toUpperCase(),
          type: 'EVM',
          chain: 'EVM'
        });
      }
    });
  }

  const tronMatches = text.match(TRON_REGEX);
  if (tronMatches) {
    tronMatches.forEach(addr => {
      if (!seen.has(addr)) {
        seen.add(addr);
        addresses.push({ address: addr, displayAddress: addr, type: 'TRON', chain: 'Tron' });
      }
    });
  }

  const solanaMatches = text.match(SOLANA_REGEX);
  if (solanaMatches) {
    solanaMatches.forEach(addr => {
      const isValid = !addr.startsWith('T') &&
        !addr.toLowerCase().startsWith('0x') &&
        !addr.includes('http') &&
        !addr.includes('www') &&
        addr.length >= 32 &&
        addr.length <= 44 &&
        !seen.has(addr);

      if (isValid) {
        seen.add(addr);
        addresses.push({ address: addr, displayAddress: addr, type: 'SOL', chain: 'Solana' });
      }
    });
  }

  return addresses;
}

module.exports = { extractContractAddresses };
