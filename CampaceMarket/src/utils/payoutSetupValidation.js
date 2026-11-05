export const getPayoutSetupStateAfterMethodChange = (payoutType) => ({
  payoutType,
  providerCode: '',
});

const normalizeProviderName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const getNameTokens = (name) => String(name || '')
  .normalize('NFKD')
  .replace(/\p{M}/gu, '')
  .toLocaleLowerCase()
  .match(/[\p{L}\p{N}]+/gu) || [];

const tokensMatch = (left, right) => left === right
  || (Math.min(left.length, right.length) >= 3 && left.slice(0, 3) === right.slice(0, 3));

export const payoutNameMatchesProfile = (payoutName, profileName) => {
  const payoutTokens = getNameTokens(payoutName);
  const profileTokens = getNameTokens(profileName);
  if (!payoutTokens.length || !profileTokens.length) return false;
  if (payoutTokens.some((payoutToken) => profileTokens.some((profileToken) => tokensMatch(payoutToken, profileToken)))) {
    return true;
  }

  const shorterTokens = payoutTokens.length <= profileTokens.length ? payoutTokens : profileTokens;
  const longerTokens = payoutTokens.length <= profileTokens.length ? profileTokens : payoutTokens;
  if (!shorterTokens.every((initial) => initial.length === 1)) return false;
  const matchedTokenIndexes = new Set();
  return shorterTokens.every((initial) => {
    const matchIndex = longerTokens.findIndex((token, index) => (
      !matchedTokenIndexes.has(index) && token.startsWith(initial)
    ));
    if (matchIndex === -1) return false;
    matchedTokenIndexes.add(matchIndex);
    return true;
  });
};

export const payoutNameNeedsAcknowledgement = (payoutName, profileName) => Boolean(
  String(payoutName || '').trim()
  && String(profileName || '').trim()
  && !payoutNameMatchesProfile(payoutName, profileName),
);

const ESSENTIAL_PROVIDERS = {
  bank: {
    cbe: {
      label: 'Commercial Bank of Ethiopia (CBE)',
      aliases: ['cbe', 'commercialbankofethiopia', 'commercialbankofethiopiacbe'],
    },
  },
  mobile_wallet: {
    telebirr: {
      label: 'Telebirr',
      aliases: ['telebirr'],
    },
    cbe_birr: {
      label: 'CBE Birr',
      aliases: ['cbebirr'],
    },
  },
};

export const getEssentialPayoutProviders = (banks, payoutType) => {
  const allowedProviders = ESSENTIAL_PROVIDERS[payoutType] || {};
  const providersByCode = new Map();
  (Array.isArray(banks) ? banks : []).forEach((bank) => {
    if (String(bank?.method || bank?.type || '').toLowerCase() !== payoutType || !bank?.code) return;
    const bankName = normalizeProviderName(bank.name || bank.bank_name);
    const provider = Object.values(allowedProviders).find(({ aliases }) => aliases.includes(bankName));
    if (provider) {
      providersByCode.set(String(bank.code), {
        code: String(bank.code),
        name: provider.label,
        method: payoutType,
      });
    }
  });
  return [...providersByCode.values()];
};

export const isValidPayoutAccountNumber = (payoutType, providerCode, accountNumber) => {
  if (payoutType === 'mobile_wallet') {
    return /^(09|07)\d{8}$/.test(accountNumber);
  }

  if (providerCode.toLowerCase() === 'comari') {
    return /^\d{13}$/.test(accountNumber);
  }

  return /^\d{10,15}$/.test(accountNumber);
};

export const isPayoutSetupValid = ({
  payoutType,
  providerCode,
  holderName,
  expectedHolderName,
  accountNumber,
  nameMismatchAcknowledged = false,
}) => Boolean(
  providerCode
  && holderName.trim()
  && (!expectedHolderName
    || !payoutNameNeedsAcknowledgement(holderName, expectedHolderName)
    || nameMismatchAcknowledged)
  && isValidPayoutAccountNumber(payoutType, providerCode, accountNumber),
);
