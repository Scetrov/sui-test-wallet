import { registerWallet } from '@mysten/wallet-standard';
import { SuiTestWallet } from './SuiTestWallet';

const wallet = new SuiTestWallet();

try {
  registerWallet(wallet);
  console.log('Sui Test Wallet Standard interface injected and registered.');
} catch (e) {
  console.error('Failed to register Sui Test Wallet Standard', e);
}
