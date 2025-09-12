const express = require('express');
const path = require('path');

const app = express();

// ВАЖНО: указываем полный путь к папке public
app.use(express.static(path.join(__dirname, 'public')));

// Данные для дашборда
const dashboardData = {
    kremenchug: {
        revenue: 1245000,
        margin: 42.5,
        profit: 529125,
        checks: 3456,
        avgCheck: 360,
        tapStatus: 'Работает',
        tapShare: 35.2,
        packShare: 45.8,
        kitchenShare: 19.0
    },
    warsaw: {
        revenue: 986000,
        margin: 38.2,
        profit: 376652,
        checks: 2890,
        avgCheck: 341,
        tapStatus: 'Остановлен',
        tapShare: 28.5,
        packShare: 52.3,
        kitchenShare: 19.2
    }
};

// API endpoint
app.get('/api/data/:location', (req, res) => {
    const location = req.params.location;
    res.json(dashboardData[location] || dashboardData.kremenchug);
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Сервер запущен!`);
    console.log(`📊 Откройте в браузере: http://localhost:${PORT}`);
    console.log(`🛑 Для остановки нажмите Ctrl+C`);
});
