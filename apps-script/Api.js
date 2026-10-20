// Web app HTTP entry. The PWA sends POST with Content-Type text/plain (no CORS preflight); the iPhone Shortcut's
// check-in comes as JSON. HTTP status is always 200 and errors come in the body: { ok: false, error, message }.

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad_request', message: 'Request body is not JSON' });
  }

  if (!isAuthorized_(req.key)) {
    return json_({ ok: false, error: 'unauthorized', message: 'Wrong key' });
  }

  try {
    switch (req.action) {
      case 'ping':
        return json_({ ok: true, serverTs: new Date().toISOString() });
      case 'sync':
        return json_(handleSync_(req));
      case 'admin':
        if (!adminEnabled_()) {
          return json_({ ok: false, error: 'forbidden', message: 'Admin access is off: spreadsheet menu → Finance OS → Turn on admin access' });
        }
        return json_(handleAdmin_(req));
      case 'checkin':
        return json_(handleCheckin_(req));
      case 'set_setting':
        return json_(handleSetSetting_(req));
      default:
        return json_({ ok: false, error: 'bad_request', message: 'Unknown action: ' + req.action });
    }
  } catch (err) {
    if (err && err.badRequest) {
      return json_({ ok: false, error: 'bad_request', message: err.message });
    }
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: 'server_error', message: String(err && err.message ? err.message : err) });
  }
}

// GET without a key reveals nothing: it only shows the service is alive.
function doGet() {
  return json_({ ok: true, app: 'finance-os' });
}

function isAuthorized_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
  return Boolean(expected) && typeof key === 'string' && key === expected;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function badRequest_(message) {
  const err = new Error(message);
  err.badRequest = true;
  return err;
}
