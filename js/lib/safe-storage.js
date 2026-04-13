// Astrion OS — Safe localStorage wrapper
// Patches Storage.prototype to prevent crashes on full storage, quota
// exceeded, or Safari private browsing mode. Import this FIRST in boot.js
// (side-effect only — no exports).

(function patchStorage() {
  const origGet = Storage.prototype.getItem;
  const origSet = Storage.prototype.setItem;
  const origRem = Storage.prototype.removeItem;

  Storage.prototype.getItem = function(key) {
    try { return origGet.call(this, key); } catch { return null; }
  };
  Storage.prototype.setItem = function(key, value) {
    try { origSet.call(this, key, value); } catch { /* quota exceeded or private browsing */ }
  };
  Storage.prototype.removeItem = function(key) {
    try { origRem.call(this, key); } catch {}
  };
})();
