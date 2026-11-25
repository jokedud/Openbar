'use strict';

function volumeLayoutMigration(settings) {
  if (settings.volumeWidgetMigrated) return null;
  const patch = { volumeWidgetMigrated: true };
  if (![settings.left, settings.center, settings.right].some((zone) => zone.includes('volume'))) {
    patch.right = [...settings.right, 'volume'];
  }
  return patch;
}

module.exports = { volumeLayoutMigration };
