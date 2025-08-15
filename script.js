const STATIONS = {
    TWICKENHAM: 'TWI',
    LONDON_STATIONS: ['WAT', 'VIC', 'CLJ', 'PAD', 'KGX', 'LST', 'CHX', 'LBG', 'CST'],
    LONDON_NAMES: {
        'WAT': 'London Waterloo',
        'VIC': 'London Victoria',
        'CLJ': 'Clapham Junction',
        'PAD': 'London Paddington',
        'KGX': 'London Kings Cross',
        'LST': 'London Liverpool Street',
        'CHX': 'London Charing Cross',
        'LBG': 'London Bridge',
        'CST': 'London Cannon Street'
    }
};

const HUXLEY_BASE = 'https://huxley2.azurewebsites.net';

let currentDirection = 'to-london';
let refreshInterval;
let trainData = [];

const elements = {
    fromStation: document.getElementById('fromStation'),
    toStation: document.getElementById('toStation'),
    switchBtn: document.getElementById('switchDirection'),
    trainsList: document.getElementById('trainsList'),
    loadingMessage: document.getElementById('loadingMessage'),
    errorMessage: document.getElementById('errorMessage'),
    noTrains: document.getElementById('noTrains'),
    lastUpdate: document.getElementById('lastUpdate'),
    refreshBtn: document.getElementById('refreshButton'),
    retryBtn: document.getElementById('retryButton')
};

function determineDirection() {
    const now = new Date();
    const londonTime = new Date(now.toLocaleString("en-US", {timeZone: "Europe/London"}));
    const hour = londonTime.getHours();
    
    return hour < 14 ? 'to-london' : 'from-london';
}

function updateDirectionDisplay() {
    if (currentDirection === 'to-london') {
        elements.fromStation.textContent = 'TWICKENHAM';
        elements.toStation.textContent = 'LONDON';
    } else {
        elements.fromStation.textContent = 'LONDON';
        elements.toStation.textContent = 'TWICKENHAM';
    }
}

function switchDirection() {
    currentDirection = currentDirection === 'to-london' ? 'from-london' : 'to-london';
    updateDirectionDisplay();
    fetchTrains();
}

async function fetchDepartures(stationCode) {
    const url = `${HUXLEY_BASE}/departures/${stationCode}`;
    const response = await fetch(url);
    
    if (!response.ok) {
        throw new Error(`Failed to fetch departures: ${response.status}`);
    }
    
    return response.json();
}

function isLondonStation(stationName, stationCode) {
    const name = stationName.toLowerCase();
    return STATIONS.LONDON_STATIONS.includes(stationCode) ||
           name.includes('london') ||
           name.includes('waterloo') ||
           name.includes('victoria') ||
           name.includes('clapham') ||
           name.includes('paddington') ||
           name.includes('kings cross') ||
           name.includes('liverpool street') ||
           name.includes('charing cross') ||
           name.includes('london bridge') ||
           name.includes('cannon street');
}

function isTwickenhamStation(stationName, stationCode) {
    const name = stationName.toLowerCase();
    return stationCode === 'TWI' || name.includes('twickenham');
}

function parseTime(timeString) {
    if (!timeString) return null;
    const [hours, minutes] = timeString.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
}

function calculateMinutesUntil(timeString) {
    const targetTime = parseTime(timeString);
    if (!targetTime) return null;
    
    const now = new Date();
    const diff = targetTime - now;
    return Math.floor(diff / 60000);
}

function formatDepartsIn(minutes) {
    if (minutes === null || minutes < 0) return 'Departed';
    if (minutes === 0) return 'Now';
    if (minutes === 1) return 'Departs in 1 min';
    return `Departs in ${minutes} min`;
}

function processTrainData(departures, direction) {
    const trains = [];
    
    if (!departures || !departures.trainServices) return trains;
    
    for (const service of departures.trainServices) {
        if (service.isCancelled) continue;
        
        const destination = service.destination?.[0];
        if (!destination) continue;
        
        const isToLondon = direction === 'to-london' && 
                          isLondonStation(destination.locationName, destination.crs);
        const isToTwickenham = direction === 'from-london' && 
                               isTwickenhamStation(destination.locationName, destination.crs);
        
        if (!isToLondon && !isToTwickenham) continue;
        
        const departureTime = service.etd === 'On time' ? service.std : service.etd;
        const minutesUntil = calculateMinutesUntil(departureTime);
        
        if (minutesUntil !== null && minutesUntil < -1) continue;
        
        const arrivalTime = service.eta || service.sta || null;
        const arrivalMinutes = arrivalTime ? 
            calculateMinutesUntil(arrivalTime) + (minutesUntil || 0) : null;
        
        trains.push({
            departureTime: service.std,
            actualDepartureTime: departureTime,
            arrivalTime: service.sta,
            actualArrivalTime: arrivalTime,
            arrivalMinutes: arrivalMinutes,
            platform: service.platform || '-',
            platformConfirmed: service.platform && !service.platform.includes('*'),
            destination: destination.locationName,
            operator: service.operator,
            isDelayed: service.etd !== 'On time' && service.etd !== 'Cancelled',
            isCancelled: service.isCancelled || false,
            minutesUntil: minutesUntil
        });
    }
    
    trains.sort((a, b) => {
        if (a.arrivalMinutes === null && b.arrivalMinutes === null) {
            return (a.minutesUntil || 0) - (b.minutesUntil || 0);
        }
        if (a.arrivalMinutes === null) return 1;
        if (b.arrivalMinutes === null) return -1;
        return a.arrivalMinutes - b.arrivalMinutes;
    });
    
    return trains.slice(0, 3);
}

async function fetchTrainsFromMultipleStations() {
    const trains = [];
    const stationsToCheck = STATIONS.LONDON_STATIONS.slice(0, 3);
    
    for (const station of stationsToCheck) {
        try {
            const data = await fetchDepartures(station);
            const processed = processTrainData(data, 'from-london');
            trains.push(...processed);
        } catch (err) {
            console.warn(`Failed to fetch from ${station}:`, err);
        }
    }
    
    trains.sort((a, b) => {
        if (a.arrivalMinutes === null && b.arrivalMinutes === null) {
            return (a.minutesUntil || 0) - (b.minutesUntil || 0);
        }
        if (a.arrivalMinutes === null) return 1;
        if (b.arrivalMinutes === null) return -1;
        return a.arrivalMinutes - b.arrivalMinutes;
    });
    
    return trains.slice(0, 3);
}

async function fetchTrains() {
    showLoading();
    
    try {
        let trains;
        
        if (currentDirection === 'to-london') {
            const data = await fetchDepartures(STATIONS.TWICKENHAM);
            trains = processTrainData(data, 'to-london');
        } else {
            trains = await fetchTrainsFromMultipleStations();
        }
        
        trainData = trains;
        displayTrains(trains);
        updateLastUpdateTime();
        
    } catch (error) {
        console.error('Error fetching trains:', error);
        showError();
    }
}

function displayTrains(trains) {
    elements.loadingMessage.classList.add('hidden');
    elements.errorMessage.classList.add('hidden');
    elements.noTrains.classList.add('hidden');
    
    if (trains.length === 0) {
        elements.noTrains.classList.remove('hidden');
        elements.trainsList.classList.add('hidden');
        return;
    }
    
    elements.trainsList.innerHTML = '';
    elements.trainsList.classList.remove('hidden');
    
    const template = document.getElementById('trainCard');
    
    trains.forEach(train => {
        const card = template.content.cloneNode(true);
        
        card.querySelector('.departure-time').textContent = train.departureTime;
        card.querySelector('.arrival-time').textContent = train.arrivalTime || '--:--';
        
        const platformBadge = card.querySelector('.platform-badge');
        platformBadge.classList.toggle('predicted', !train.platformConfirmed);
        card.querySelector('.platform-number').textContent = train.platform;
        
        const departsIn = card.querySelector('.departs-in');
        departsIn.textContent = formatDepartsIn(train.minutesUntil);
        if (train.minutesUntil !== null && train.minutesUntil <= 2) {
            departsIn.classList.add('urgent');
        } else if (train.minutesUntil !== null && train.minutesUntil <= 5) {
            departsIn.classList.add('soon');
        }
        
        const statusBadge = card.querySelector('.status-badge');
        if (train.isCancelled) {
            statusBadge.textContent = 'Cancelled';
            statusBadge.classList.add('cancelled');
        } else if (train.isDelayed) {
            statusBadge.textContent = `Delayed`;
            statusBadge.classList.add('delayed');
        } else {
            statusBadge.textContent = 'On Time';
            statusBadge.classList.add('on-time');
        }
        
        card.querySelector('.destination').textContent = train.destination;
        card.querySelector('.operator').textContent = train.operator;
        
        elements.trainsList.appendChild(card);
    });
}

function showLoading() {
    elements.loadingMessage.classList.remove('hidden');
    elements.errorMessage.classList.add('hidden');
    elements.noTrains.classList.add('hidden');
    elements.trainsList.classList.add('hidden');
}

function showError() {
    elements.loadingMessage.classList.add('hidden');
    elements.errorMessage.classList.remove('hidden');
    elements.noTrains.classList.add('hidden');
    elements.trainsList.classList.add('hidden');
}

function updateLastUpdateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Europe/London'
    });
    elements.lastUpdate.textContent = timeString;
}

function startAutoRefresh() {
    stopAutoRefresh();
    refreshInterval = setInterval(() => {
        fetchTrains();
    }, 30000);
}

function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

function handleRefresh() {
    elements.refreshBtn.classList.add('refreshing');
    fetchTrains().finally(() => {
        setTimeout(() => {
            elements.refreshBtn.classList.remove('refreshing');
        }, 500);
    });
}

function initializePullToRefresh() {
    let startY = 0;
    let isPulling = false;
    
    document.addEventListener('touchstart', (e) => {
        if (window.scrollY === 0) {
            startY = e.touches[0].pageY;
            isPulling = true;
        }
    });
    
    document.addEventListener('touchmove', (e) => {
        if (!isPulling) return;
        
        const y = e.touches[0].pageY;
        const diff = y - startY;
        
        if (diff > 100) {
            isPulling = false;
            handleRefresh();
        }
    });
    
    document.addEventListener('touchend', () => {
        isPulling = false;
    });
}

function initialize() {
    currentDirection = determineDirection();
    updateDirectionDisplay();
    
    elements.switchBtn.addEventListener('click', switchDirection);
    elements.refreshBtn.addEventListener('click', handleRefresh);
    elements.retryBtn.addEventListener('click', fetchTrains);
    
    initializePullToRefresh();
    
    fetchTrains();
    startAutoRefresh();
    
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopAutoRefresh();
        } else {
            fetchTrains();
            startAutoRefresh();
        }
    });
}

initialize();