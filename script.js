const STATIONS = {
    TWICKENHAM: 'TWI',
    WATERLOO: 'WAT'
};

const HUXLEY_BASE = 'https://huxley2.azurewebsites.net';

let currentDirection = 'to-london';
let refreshInterval;
let countdownInterval;
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
        elements.toStation.textContent = 'LONDON WATERLOO';
    } else {
        elements.fromStation.textContent = 'LONDON WATERLOO';
        elements.toStation.textContent = 'TWICKENHAM';
    }
}

function switchDirection() {
    currentDirection = currentDirection === 'to-london' ? 'from-london' : 'to-london';
    updateDirectionDisplay();
    fetchTrains();
}

async function fetchFilteredDepartures(fromStation, toStation) {
    const url = `${HUXLEY_BASE}/departures/${fromStation}/to/${toStation}`;
    const response = await fetch(url);
    
    if (!response.ok) {
        throw new Error(`Failed to fetch departures: ${response.status}`);
    }
    
    return response.json();
}

async function fetchServiceDetails(serviceId) {
    const url = `${HUXLEY_BASE}/service/${serviceId}`;
    const response = await fetch(url);
    
    if (!response.ok) {
        console.warn(`Failed to fetch service details: ${response.status}`);
        return null;
    }
    
    return response.json();
}

function parseTime(timeString) {
    if (!timeString) return null;
    const [hours, minutes] = timeString.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
}

function calculateSecondsUntil(timeString) {
    const targetTime = parseTime(timeString);
    if (!targetTime) return null;
    
    const now = new Date();
    const diff = targetTime - now;
    return Math.floor(diff / 1000);
}

function formatDepartsIn(seconds) {
    if (seconds === null || seconds < 0) return 'Departed';
    if (seconds < 60) return `${seconds}s`;
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes === 0) return `${remainingSeconds}s`;
    if (remainingSeconds === 0) return `${minutes}m`;
    return `${minutes}m ${remainingSeconds}s`;
}

function calculateDuration(departureTime, arrivalTime) {
    if (!departureTime || !arrivalTime) return null;
    
    const dep = parseTime(departureTime);
    const arr = parseTime(arrivalTime);
    
    if (!dep || !arr) return null;
    
    const diffMs = arr - dep;
    const minutes = Math.floor(diffMs / 60000);
    
    if (minutes < 0) return null;
    return `${minutes} mins`;
}

async function processTrainData(departures, fromStation, toStation) {
    const trains = [];
    
    if (!departures || !departures.trainServices) return trains;
    
    for (const service of departures.trainServices.slice(0, 6)) {
        if (service.isCancelled) continue;
        
        const departureTime = service.std;
        const actualDepartureTime = service.etd === 'On time' ? service.std : service.etd;
        const secondsUntil = calculateSecondsUntil(actualDepartureTime);
        
        if (secondsUntil !== null && secondsUntil < -60) continue;
        
        let arrivalTime = null;
        let actualArrivalTime = null;
        
        try {
            const details = await fetchServiceDetails(service.serviceIdUrlSafe);
            if (details && details.locations) {
                const targetLocation = details.locations.find(loc => 
                    loc.crs === toStation
                );
                
                if (targetLocation) {
                    // For arrivals, use 'st' (scheduled time) and 'et' (expected time)
                    // For departures from a station, it would be 'sta' and 'eta'
                    arrivalTime = targetLocation.st || targetLocation.sta;
                    const expectedTime = targetLocation.et || targetLocation.eta;
                    actualArrivalTime = (expectedTime === 'On time' || !expectedTime) ? arrivalTime : expectedTime;
                }
            }
        } catch (err) {
            console.warn('Could not fetch arrival time:', err);
        }
        
        const duration = calculateDuration(actualDepartureTime, actualArrivalTime);
        
        trains.push({
            departureTime: departureTime,
            actualDepartureTime: actualDepartureTime,
            arrivalTime: arrivalTime,
            actualArrivalTime: actualArrivalTime,
            duration: duration,
            platform: service.platform || '-',
            platformConfirmed: service.platform && !service.platform.includes('*'),
            destination: service.destination[0].locationName,
            operator: service.operator,
            isDelayed: service.etd !== 'On time' && service.etd !== 'Cancelled',
            isCancelled: service.isCancelled || false,
            secondsUntil: secondsUntil,
            arrivalSecondsFromNow: actualArrivalTime ? calculateSecondsUntil(actualArrivalTime) : null
        });
    }
    
    // Sort by actual arrival time (accounting for delays)
    trains.sort((a, b) => {
        // If both have arrival times, sort by those
        if (a.arrivalSecondsFromNow !== null && b.arrivalSecondsFromNow !== null) {
            return a.arrivalSecondsFromNow - b.arrivalSecondsFromNow;
        }
        // If only one has arrival time, prioritize it
        if (a.arrivalSecondsFromNow === null && b.arrivalSecondsFromNow !== null) return 1;
        if (a.arrivalSecondsFromNow !== null && b.arrivalSecondsFromNow === null) return -1;
        // If neither has arrival time, sort by departure
        return (a.secondsUntil || 0) - (b.secondsUntil || 0);
    });
    
    return trains.slice(0, 3);
}

async function fetchTrains() {
    showLoading();
    stopCountdown();
    
    try {
        let trains;
        
        if (currentDirection === 'to-london') {
            const data = await fetchFilteredDepartures(STATIONS.TWICKENHAM, STATIONS.WATERLOO);
            trains = await processTrainData(data, STATIONS.TWICKENHAM, STATIONS.WATERLOO);
        } else {
            const data = await fetchFilteredDepartures(STATIONS.WATERLOO, STATIONS.TWICKENHAM);
            trains = await processTrainData(data, STATIONS.WATERLOO, STATIONS.TWICKENHAM);
        }
        
        trainData = trains;
        displayTrains(trains);
        updateLastUpdateTime();
        startCountdown();
        
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
    
    trains.forEach((train, index) => {
        const card = template.content.cloneNode(true);
        
        // Display actual times (with delays) instead of scheduled times
        card.querySelector('.departure-time').textContent = train.actualDepartureTime;
        card.querySelector('.arrival-time').textContent = train.actualArrivalTime || '--:--';
        
        const platformBadge = card.querySelector('.platform-badge');
        platformBadge.classList.toggle('predicted', !train.platformConfirmed);
        card.querySelector('.platform-number').textContent = train.platform;
        
        const departsIn = card.querySelector('.departs-in');
        departsIn.setAttribute('data-seconds', train.secondsUntil || 0);
        departsIn.textContent = formatDepartsIn(train.secondsUntil);
        
        // Color coding: >20min green, 15-20min amber, 5-15min red, <5min dark red
        if (train.secondsUntil !== null) {
            const minutes = train.secondsUntil / 60;
            if (minutes < 5) {
                departsIn.classList.add('critical');
            } else if (minutes < 15) {
                departsIn.classList.add('urgent');
            } else if (minutes < 20) {
                departsIn.classList.add('warning');
            } else {
                departsIn.classList.add('safe');
            }
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
        
        const destination = card.querySelector('.destination');
        destination.textContent = train.destination;
        
        const operator = card.querySelector('.operator');
        if (train.duration) {
            operator.textContent = `${train.operator} • ${train.duration}`;
        } else {
            operator.textContent = train.operator;
        }
        
        elements.trainsList.appendChild(card);
    });
}

function updateCountdowns() {
    const departsInElements = document.querySelectorAll('.departs-in');
    
    departsInElements.forEach(element => {
        let seconds = parseInt(element.getAttribute('data-seconds'));
        
        if (!isNaN(seconds)) {
            seconds--;
            element.setAttribute('data-seconds', seconds);
            element.textContent = formatDepartsIn(seconds);
            
            // Update color classes based on new time
            element.classList.remove('safe', 'warning', 'urgent', 'critical');
            if (seconds > 0) {
                const minutes = seconds / 60;
                if (minutes < 5) {
                    element.classList.add('critical');
                } else if (minutes < 15) {
                    element.classList.add('urgent');
                } else if (minutes < 20) {
                    element.classList.add('warning');
                } else {
                    element.classList.add('safe');
                }
            }
        }
    });
}

function startCountdown() {
    stopCountdown();
    countdownInterval = setInterval(updateCountdowns, 1000);
}

function stopCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
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
            stopCountdown();
        } else {
            fetchTrains();
            startAutoRefresh();
        }
    });
}

initialize();