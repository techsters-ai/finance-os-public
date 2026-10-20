// Sync: upsert by id (last write wins by updated_at) + changes with server_ts > since.

function handleSync_(req) {
  const ops = Array.isArray(req.ops) ? req.ops : [];
  if (ops.length > MAX_OPS_PER_REQUEST) throw badRequest_('Too many ops in one request: ' + ops.length);
  const since = typeof req.since === 'string' && req.since ? req.since : null;

  const byEntity = { accounts: [], categories: [], transactions: [], automations: [], tax_marks: [], locations: [] };
  ops.forEach(op => {
    if (!op || !byEntity[op.entity]) throw badRequest_('Unknown entity: ' + (op && op.entity));
    if (!op.record || !op.record.id) throw badRequest_('Record without id in ' + op.entity);
    byEntity[op.entity].push(op.record);
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const serverTs = new Date().toISOString();
    const touched = { accounts: {}, categories: {}, transactions: {}, automations: {}, tax_marks: {}, locations: {} };
    let applied = 0;
    let ledgerChanged = false;
    const rates = readRates_();

    Object.keys(byEntity).forEach(entity => {
      if (!byEntity[entity].length) return;
      const n = applyRecords_(entity, byEntity[entity], serverTs, touched[entity], rates);
      applied += n;
      if (n && entity !== 'locations') ledgerChanged = true; // days in countries don't touch the money
    });
    SpreadsheetApp.flush();
    if (ledgerChanged) {
      try {
        markTaxesDirty_();
      } catch (err) {
        console.warn('Taxes not scheduled: ' + err);
      }
    }

    const cutoff = since ? new Date(new Date(since).getTime() - SINCE_OVERLAP_MS).toISOString() : null;
    const changes = {};
    Object.keys(byEntity).forEach(entity => {
      changes[entity] = readChangedRecords_(entity, cutoff, touched[entity]);
    });

    // The TaxRates rows (~150 KB) go only when they changed: the app sends the hash of the ones it has.
    const taxRates = readTaxRates_();
    const taxRatesHash = hashOf_(taxRates);
    const out = {
      ok: true, serverTs, applied, changes, rates, settings: readSettings_(), metrics: readMetrics_(), history: readHistory_(),
      allocation: readAllocationConfig_(), taxes: readTaxesSummary_(), taxRatesHash,
    };
    if (req.taxRatesHash !== taxRatesHash) out.taxRates = taxRates;
    return out;
  } finally {
    lock.releaseLock();
  }
}

function applyRecords_(entity, records, serverTs, touched, rates) {
  const sh = sheetFor_(entity);
  const { headers, rows } = readTable_(sh);
  const col = colIndex_(headers);
  if (col.id === undefined || col.updated_at === undefined || col.server_ts === undefined) {
    throw new Error('Sheet ' + SHEETS[entity] + ' has no id / updated_at / server_ts columns');
  }

  const originalCount = rows.length;
  const position = {};
  rows.forEach((r, i) => { if (r[col.id] !== '') position[String(r[col.id])] = i; });
  const dirty = {};
  let applied = 0;

  records.forEach(raw => {
    const rec = entity === 'transactions' ? normalizeTransaction_(raw, rates) : raw;
    const id = String(rec.id);
    touched[id] = true;
    const pos = position[id];

    if (pos !== undefined) {
      const existingUpdated = String(rows[pos][col.updated_at] || '');
      const incomingUpdated = String(rec.updated_at || '');
      // The sheet version is newer (e.g. a manual edit in Sheets): keep it, the client gets it in changes.
      if (existingUpdated && incomingUpdated && incomingUpdated < existingUpdated) return;
      rows[pos] = recordToRow_(entity, headers, rec, rows[pos], serverTs);
      if (pos < originalCount) dirty[pos] = true;
    } else {
      position[id] = rows.length;
      rows.push(recordToRow_(entity, headers, rec, null, serverTs));
    }
    applied++;
  });

  Object.keys(dirty).forEach(p => {
    const i = Number(p);
    sh.getRange(i + 2, 1, 1, headers.length).setValues([rows[i]]);
  });
  appendRows_(sh, rows.slice(originalCount));
  return applied;
}

// The server fills in what the client may have left out: the USD rate and the USD amount.
function normalizeTransaction_(rec, rates) {
  const out = Object.assign({}, rec);
  const amount = Number(out.amount);
  let rate = Number(out.usd_rate);
  if ((!isFinite(rate) || rate <= 0) && out.account_id) {
    const cur = accountCurrency_(out.account_id);
    if (cur && rates[cur]) rate = rates[cur];
    if (isFinite(rate) && rate > 0) out.usd_rate = rate;
  }
  if ((out.amount_usd === undefined || out.amount_usd === '' || out.amount_usd === null) && isFinite(amount) && isFinite(rate)) {
    out.amount_usd = amount * rate;
  }
  if (!out.created_at) out.created_at = out.updated_at || new Date().toISOString();
  if (out.deleted === undefined) out.deleted = false;
  return out;
}

let accountCurrencyCache_ = null;
function accountCurrency_(accountId) {
  if (!accountCurrencyCache_) {
    accountCurrencyCache_ = {};
    readRecords_('accounts').forEach(a => { accountCurrencyCache_[a.id] = a.currency; });
  }
  return accountCurrencyCache_[accountId] || '';
}
