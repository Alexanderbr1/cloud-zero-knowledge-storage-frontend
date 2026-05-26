// karma.conf.js
// Базовая конфигурация генерируется @angular-devkit/build-angular:karma.
// Этот файл добавляет только customLaunchers — всё остальное остаётся дефолтным.
module.exports = function (config) {
  config.set({
    customLaunchers: {
      // Используется в CI (GitHub Actions, Docker) — Chrome без sandbox
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      },
    },
  });
};
