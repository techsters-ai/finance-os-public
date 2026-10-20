// Account picker sheet: accounts by group, hidden ones behind a "Show hidden" row.
import { useState } from 'preact/hooks';
import { accountHidden, activeAccounts, balances } from '../data/store';
import type { Account } from '../domain/types';
import { AccountIcon, Money, Row, Section, Sheet } from './components';
import { GROUP_TITLE } from './screens/Accounts';

const ORDER: Account['group'][] = ['liquid', 'credit', 'business', 'investment', 'debt'];

export function AccountPickerSheet({
  open,
  title,
  selected,
  exclude,
  groups = ORDER,
  footer,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  selected?: string;
  exclude?: string;
  /** Which groups to offer, in this order. */
  groups?: Account['group'][];
  footer?: string;
  onPick: (a: Account) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const pool = activeAccounts.value.filter((a) => a.id !== exclude && groups.includes(a.group));
  const hiddenCount = pool.filter((a) => a.id !== selected && accountHidden(a)).length;
  const shown = all ? pool : pool.filter((a) => a.id === selected || !accountHidden(a));
  const close = () => {
    setAll(false);
    onClose();
  };
  return (
    <Sheet open={open} title={title} onClose={close}>
      {groups.map((g) => {
        const list = shown.filter((a) => a.group === g);
        if (!list.length) return null;
        return (
          <Section key={g} title={GROUP_TITLE[g]}>
            {list.map((a) => (
              <Row
                key={a.id}
                icon={<AccountIcon account={a} size={30} />}
                title={a.name}
                subtitle={a.institution || a.currency}
                value={<Money value={balances.value.get(a.id) ?? 0} currency={a.currency} />}
                checked={a.id === selected}
                onClick={() => {
                  setAll(false);
                  onPick(a);
                }}
              />
            ))}
          </Section>
        );
      })}
      {hiddenCount > 0 && (
        <div class="more">
          <button type="button" class="btn btn-plain" onClick={() => setAll(!all)}>
            {all ? `Hide hidden (${hiddenCount})` : `Show hidden (${hiddenCount})`}
          </button>
        </div>
      )}
      {footer && <div class="section-footer sheet-foot">{footer}</div>}
    </Sheet>
  );
}
