// Remove the saved, encrypted OKX credentials. The next start:private asks again.
import { credentialLocation, forgetCredentials } from './credential-store';
forgetCredentials();
console.log(
  `已删除本机保存的 OKX 凭证（${credentialLocation()}）。下次运行 npm run start:private 需要重新输入。`,
);
