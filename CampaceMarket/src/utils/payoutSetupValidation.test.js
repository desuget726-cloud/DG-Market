import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getEssentialPayoutProviders,
  getPayoutSetupStateAfterMethodChange,
  isPayoutSetupValid,
  isValidPayoutAccountNumber,
  payoutNameMatchesProfile,
  payoutNameNeedsAcknowledgement,
} from './payoutSetupValidation.js';

test('payout provider choices are restricted to CBE, Telebirr, and CBE Birr', () => {
  const banks = [
    { code: '901', name: 'Commercial Bank of Ethiopia', method: 'bank' },
    { code: '855', name: 'telebirr', method: 'mobile_wallet' },
    { code: '128', name: 'CBEBirr', method: 'mobile_wallet' },
    { code: '266', name: 'M-Pesa', method: 'mobile_wallet' },
    { code: '836', name: 'Cooperative Bank of Oromia', method: 'bank' },
  ];

  assert.deepEqual(getEssentialPayoutProviders(banks, 'bank'), [
    { code: '901', name: 'Commercial Bank of Ethiopia (CBE)', method: 'bank' },
  ]);
  assert.deepEqual(getEssentialPayoutProviders(banks, 'mobile_wallet'), [
    { code: '855', name: 'Telebirr', method: 'mobile_wallet' },
    { code: '128', name: 'CBE Birr', method: 'mobile_wallet' },
  ]);
});

test('changing payout method clears the previously selected provider', () => {
  assert.deepEqual(getPayoutSetupStateAfterMethodChange('mobile_wallet'), {
    payoutType: 'mobile_wallet',
    providerCode: '',
  });
});

test('mobile money numbers require the Ethiopian 09 or 07 format', () => {
  assert.equal(isValidPayoutAccountNumber('mobile_wallet', '855', '0912345678'), true);
  assert.equal(isValidPayoutAccountNumber('mobile_wallet', '855', '0712345678'), true);
  assert.equal(isValidPayoutAccountNumber('mobile_wallet', '855', '0812345678'), false);
  assert.equal(isValidPayoutAccountNumber('mobile_wallet', '855', '091234567'), false);
});

test('invalid account numbers keep payout setup from being saveable', () => {
  assert.equal(isPayoutSetupValid({
    payoutType: 'mobile_wallet',
    providerCode: '855',
    holderName: 'Payout Owner',
    expectedHolderName: 'Payout Owner',
    accountNumber: '0812345678',
  }), false);
  assert.equal(isPayoutSetupValid({
    payoutType: 'mobile_wallet',
    providerCode: '855',
    holderName: 'Payout Owner',
    expectedHolderName: 'Payout Owner',
    accountNumber: '0912345678',
  }), true);
  assert.equal(isPayoutSetupValid({
    payoutType: 'mobile_wallet',
    providerCode: '855',
    holderName: 'Different Person',
    expectedHolderName: 'Payout Owner',
    accountNumber: '0912345678',
  }), false);
});

test('payout names accept matching full names, shared name tokens, and initials', () => {
  assert.equal(payoutNameMatchesProfile('Desu', 'Desalegn'), true);
  assert.equal(payoutNameMatchesProfile('Desu Mekonnen', 'Desalegn Mekonnen'), true);
  assert.equal(payoutNameMatchesProfile('D M', 'Desalegn Mekonnen'), true);
  assert.equal(payoutNameMatchesProfile('Mekonnen', 'Desalegn Mekonnen'), true);
  assert.equal(payoutNameNeedsAcknowledgement('Desu Mekonnen', 'Desalegn Mekonnen'), false);
});

test('significantly different payout names need explicit acknowledgment to pass validation', () => {
  const payoutDetails = {
    payoutType: 'bank',
    providerCode: '901',
    holderName: 'Authorized Family Member',
    expectedHolderName: 'Desalegn Mekonnen',
    accountNumber: '1234567890',
  };
  assert.equal(payoutNameNeedsAcknowledgement(payoutDetails.holderName, payoutDetails.expectedHolderName), true);
  assert.equal(isPayoutSetupValid(payoutDetails), false);
  assert.equal(isPayoutSetupValid({ ...payoutDetails, nameMismatchAcknowledged: true }), true);
});
