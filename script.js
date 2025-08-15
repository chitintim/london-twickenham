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
    
    // Fetch more trains to ensure we get 5 good ones after filtering
    for (const service of departures.trainServices.slice(0, 10)) {
        // Skip cancelled trains entirely
        if (service.isCancelled || service.etd === 'Cancelled') continue;
        
        const departureTime = service.std;
        // If ETD is "Delayed" without a specific time, use scheduled time
        let actualDepartureTime;
        if (service.etd === 'On time' || service.etd === 'Delayed') {
            actualDepartureTime = service.std;
        } else {
            actualDepartureTime = service.etd;
        }
        const secondsUntil = calculateSecondsUntil(actualDepartureTime);
        
        if (secondsUntil !== null && secondsUntil < -60) continue;
        
        let arrivalTime = null;
        let actualArrivalTime = null;
        
        try {
            const details = await fetchServiceDetails(service.serviceIdUrlSafe);
            if (details) {
                // Check subsequentCallingPoints for future stops
                if (details.subsequentCallingPoints && details.subsequentCallingPoints.length > 0) {
                    const callingPoints = details.subsequentCallingPoints[0].callingPoint || [];
                    const targetLocation = callingPoints.find(loc => loc.crs === toStation);
                    
                    if (targetLocation) {
                        arrivalTime = targetLocation.st;
                        const expectedTime = targetLocation.et;
                        
                        // Handle "Delayed" without specific time
                        if (expectedTime === 'Delayed' && actualDepartureTime !== departureTime) {
                            // Calculate delay from departure and apply to arrival
                            const depDelayMs = parseTime(actualDepartureTime) - parseTime(departureTime);
                            if (depDelayMs && arrivalTime) {
                                const scheduledArrival = parseTime(arrivalTime);
                                const estimatedArrival = new Date(scheduledArrival.getTime() + depDelayMs);
                                actualArrivalTime = `${String(estimatedArrival.getHours()).padStart(2, '0')}:${String(estimatedArrival.getMinutes()).padStart(2, '0')}`;
                            } else {
                                actualArrivalTime = arrivalTime;
                            }
                        } else if (expectedTime === 'On time' || expectedTime === 'Delayed' || !expectedTime) {
                            actualArrivalTime = arrivalTime;
                        } else {
                            actualArrivalTime = expectedTime;
                        }
                    }
                }
                
                // If not found in subsequent, check previous calling points (for return journeys)
                if (!arrivalTime && details.previousCallingPoints && details.previousCallingPoints.length > 0) {
                    const callingPoints = details.previousCallingPoints[0].callingPoint || [];
                    const targetLocation = callingPoints.find(loc => loc.crs === toStation);
                    
                    if (targetLocation) {
                        arrivalTime = targetLocation.st;
                        const actualTime = targetLocation.at;
                        
                        // Handle "Delayed" without specific time
                        if (actualTime === 'Delayed' && actualDepartureTime !== departureTime) {
                            // Calculate delay from departure and apply to arrival
                            const depDelayMs = parseTime(actualDepartureTime) - parseTime(departureTime);
                            if (depDelayMs && arrivalTime) {
                                const scheduledArrival = parseTime(arrivalTime);
                                const estimatedArrival = new Date(scheduledArrival.getTime() + depDelayMs);
                                actualArrivalTime = `${String(estimatedArrival.getHours()).padStart(2, '0')}:${String(estimatedArrival.getMinutes()).padStart(2, '0')}`;
                            } else {
                                actualArrivalTime = arrivalTime;
                            }
                        } else if (actualTime === 'On time' || actualTime === 'Delayed' || !actualTime) {
                            actualArrivalTime = arrivalTime;
                        } else {
                            actualArrivalTime = actualTime;
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('Could not fetch arrival time:', err);
        }
        
        // Skip this train if arrival is cancelled
        if (actualArrivalTime === 'Cancelled') continue;
        
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
            isDelayed: service.etd !== 'On time' && service.etd !== 'Cancelled' && service.etd !== null,
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
    
    // Filter out illogical trains (uses actual times with delays)
    const filteredTrains = [];
    for (let i = 0; i < trains.length; i++) {
        const currentTrain = trains[i];
        let isLogical = true;
        
        // Check against all previously accepted trains
        for (const acceptedTrain of filteredTrains) {
            // Compare using actual times (secondsUntil is based on actualDepartureTime)
            // If this train departs before an accepted train but arrives after it, skip it
            if (currentTrain.secondsUntil !== null && acceptedTrain.secondsUntil !== null &&
                currentTrain.arrivalSecondsFromNow !== null && acceptedTrain.arrivalSecondsFromNow !== null) {
                
                // This uses live/actual times since secondsUntil and arrivalSecondsFromNow 
                // are calculated from actualDepartureTime and actualArrivalTime
                if (currentTrain.secondsUntil < acceptedTrain.secondsUntil && 
                    currentTrain.arrivalSecondsFromNow > acceptedTrain.arrivalSecondsFromNow) {
                    isLogical = false;
                    console.log(`Filtering out illogical train: departs ${currentTrain.actualDepartureTime} arrives ${currentTrain.actualArrivalTime}`);
                    break;
                }
            }
        }
        
        if (isLogical) {
            filteredTrains.push(currentTrain);
            if (filteredTrains.length >= 5) break; // Stop once we have 5 trains
        }
    }
    
    return filteredTrains;
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
        
        // Display times - show scheduled crossed out if delayed
        const departureTimeEl = card.querySelector('.departure-time');
        const arrivalTimeEl = card.querySelector('.arrival-time');
        
        if (train.isDelayed && train.departureTime !== train.actualDepartureTime) {
            departureTimeEl.innerHTML = `<span class="scheduled-time">${train.departureTime}</span> ${train.actualDepartureTime}`;
        } else {
            departureTimeEl.textContent = train.actualDepartureTime;
        }
        
        if (train.isDelayed && train.arrivalTime && train.arrivalTime !== train.actualArrivalTime) {
            arrivalTimeEl.innerHTML = `<span class="scheduled-time">${train.arrivalTime}</span> ${train.actualArrivalTime || '--:--'}`;
        } else {
            arrivalTimeEl.textContent = train.actualArrivalTime || '--:--';
        }
        
        const platformBadge = card.querySelector('.platform-badge');
        platformBadge.classList.toggle('predicted', !train.platformConfirmed);
        card.querySelector('.platform-number').textContent = train.platform;
        
        const departsIn = card.querySelector('.departs-in');
        departsIn.setAttribute('data-seconds', train.secondsUntil || 0);
        departsIn.textContent = formatDepartsIn(train.secondsUntil);
        
        // Color coding: departed grey, >20min green, 15-20min amber, 5-15min red, <5min dark red
        if (train.secondsUntil === null || train.secondsUntil < 0) {
            departsIn.classList.add('departed');
        } else {
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
            element.classList.remove('safe', 'warning', 'urgent', 'critical', 'departed');
            if (seconds <= 0) {
                element.classList.add('departed');
            } else {
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