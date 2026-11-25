'use strict';

function hasVolumeWidget(settings) {
  return [settings.left, settings.center, settings.right].some((zone) => zone.includes('volume')) ||
    (settings.customTabs || []).some((tab) => tab.items.some((item) => item.kind === 'widget' && item.widget === 'volume'));
}

function volumeLayoutMigration(settings) {
  if (settings.volumeWidgetMigrated) return null;
  const patch = { volumeWidgetMigrated: true };
  if (!hasVolumeWidget(settings)) {
    patch.right = [...settings.right, 'volume'];
  }
  return patch;
}

module.exports = { hasVolumeWidget, volumeLayoutMigration };
