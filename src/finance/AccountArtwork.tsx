import { useState } from "react";
import type { Account } from "../../domain/model";
import { Icon } from "../design-system/ui";

function faviconUrl(value?: string) {
  if (!value) return undefined;
  try {
    return `${new URL(value).origin}/favicon.ico`;
  } catch {
    return undefined;
  }
}

export function AccountArtwork({
  account,
  size = 21,
}: {
  account: Account;
  size?: number;
}) {
  const source =
    account.imageDataUrl ??
    (account.kind === "bank" ? faviconUrl(account.institutionUrl) : undefined);
  const [failedSource, setFailedSource] = useState<string>();
  if (source && source !== failedSource)
    return (
      <img
        className="account-artwork-image"
        src={source}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedSource(source)}
      />
    );
  return (
    <Icon
      name={
        account.kind === "credit"
          ? "card"
          : account.kind === "cash"
            ? "wallet"
            : account.kind === "loan" ? "loan" : account.kind === "pocket" ? "pocket" : account.kind === "investment" ? "investment" : "bank"
      }
      size={size}
    />
  );
}
