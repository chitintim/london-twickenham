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
    // Check if user has a saved preference
    const savedDirection = localStorage.getItem('trainDirection');
    if (savedDirection) {
        return savedDirection;
    }
    
    // Otherwise use time-based default
    const now = new Date();
    const londonTime = new Date(now.toLocaleString("en-US", {timeZone: "Europe/London"}));
    const hour = londonTime.getHours();
    
    // Morning commute (4am-2pm): Twickenham to London
    // Evening/night (2pm-4am): London to Twickenham
    if (hour >= 4 && hour < 14) {
        return 'to-london';
    } else {
        return 'from-london';
    }
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
    // Save user's preference
    localStorage.setItem('trainDirection', currentDirection);
    updateDirectionDisplay();
    fetchTrains();
}

async function fetchFilteredDepartures(fromStation, toStation) {
    // For WAT->TWI, we need a hybrid approach
    // The /to/ endpoint has false positives but is still useful as a starting point
    
    if (fromStation === 'WAT' && toStation === 'TWI') {
        // First try the /to/ endpoint
        const filteredUrl = `${HUXLEY_BASE}/departures/${fromStation}/to/${toStation}?rows=20`;
        const filteredResponse = await fetch(filteredUrl);
        
        if (filteredResponse.ok) {
            const filteredData = await filteredResponse.json();
            
            // Also fetch unfiltered to catch any trains the /to/ endpoint might miss
            const unfilteredUrl = `${HUXLEY_BASE}/departures/${fromStation}?rows=30`;
            const unfilteredResponse = await fetch(unfilteredUrl);
            
            if (unfilteredResponse.ok) {
                const unfilteredData = await unfilteredResponse.json();
                
                // Combine both results, prioritizing the filtered ones
                const combinedServices = [];
                const seenIds = new Set();
                
                // Add filtered results first
                if (filteredData.trainServices) {
                    filteredData.trainServices.forEach(service => {
                        combinedServices.push(service);
                        seenIds.add(service.serviceIdUrlSafe);
                    });
                }
                
                // Add unfiltered trains that might go to TWI
                if (unfilteredData.trainServices) {
                    const twiDestinations = ['Richmond', 'Hounslow', 'Shepperton', 'Brentford', 'Reading', 'Windsor'];
                    unfilteredData.trainServices.forEach(service => {
                        if (!seenIds.has(service.serviceIdUrlSafe)) {
                            const dest = service.destination?.[0]?.locationName || '';
                            if (twiDestinations.some(d => dest.includes(d))) {
                                combinedServices.push(service);
                            }
                        }
                    });
                }
                
                return { ...filteredData, trainServices: combinedServices };
            }
            
            return filteredData;
        }
    }
    
    // For other routes, use the standard /to/ endpoint
    const url = `${HUXLEY_BASE}/departures/${fromStation}/to/${toStation}?rows=15`;
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

function parseTime(timeString, referenceTime = null) {
    if (!timeString) return null;
    const [hours, minutes] = timeString.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    
    // If we have a reference time and the parsed time is before it,
    // assume it's the next day
    if (referenceTime && typeof referenceTime === 'string') {
        const [refHours, refMinutes] = referenceTime.split(':').map(Number);
        const refDate = new Date();
        refDate.setHours(refHours, refMinutes, 0, 0);
        
        if (date < refDate) {
            date.setDate(date.getDate() + 1);
        }
    } else if (referenceTime instanceof Date && date < referenceTime) {
        date.setDate(date.getDate() + 1);
    }
    
    return date;
}

function calculateSecondsUntil(timeString, referenceTime = null) {
    const targetTime = parseTime(timeString, referenceTime);
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
    const arr = parseTime(arrivalTime, departureTime); // Use departure as reference
    
    if (!dep || !arr) return null;
    
    const diffMs = arr - dep;
    const minutes = Math.floor(diffMs / 60000);
    
    if (minutes < 0) return null;
    return `${minutes} mins`;
}

async function processTrainData(departures, fromStation, toStation) {
    const trains = [];
    const journeyTimeCache = new Map(); // Cache journey times from similar trains
    
    if (!departures || !departures.trainServices) return trains;
    
    // Check more services for WAT->TWI since we need to verify each one
    const maxToCheck = (fromStation === 'WAT' && toStation === 'TWI') ? 20 : 10;
    const servicesToCheck = departures.trainServices.slice(0, maxToCheck);
    
    for (const service of servicesToCheck) {
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
        let skipTrain = false;
        
        try {
            const details = await fetchServiceDetails(service.serviceIdUrlSafe);
            if (details) {
                // ONLY check subsequentCallingPoints for future stops (destination should be ahead)
                if (details.subsequentCallingPoints && details.subsequentCallingPoints.length > 0) {
                    const callingPoints = details.subsequentCallingPoints[0].callingPoint || [];
                    const targetLocation = callingPoints.find(loc => loc.crs === toStation);
                    
                    // Check if train stops at our destination
                    if (!targetLocation) {
                        // Try to estimate arrival time based on similar trains
                        const destName = service.destination?.[0]?.locationName || '';
                        const cacheKey = `${fromStation}-${toStation}-${destName}`;
                        
                        if (journeyTimeCache.has(cacheKey)) {
                            // Use cached journey time for estimation
                            const typicalJourneyMs = journeyTimeCache.get(cacheKey);
                            const estArrival = new Date(parseTime(actualDepartureTime).getTime() + typicalJourneyMs);
                            const estTime = `${String(estArrival.getHours()).padStart(2, '0')}:${String(estArrival.getMinutes()).padStart(2, '0')}`;
                            console.log(`Estimated arrival at ${toStation} for ${destName} train: ${estTime} (based on similar trains)`);
                            arrivalTime = 'Estimated';
                            actualArrivalTime = `~${estTime} (est)`;
                        } else {
                            // No data to estimate, show Check at station
                            console.warn(`${toStation} not found for ${destName} train - marking as 'Check at station'`);
                            arrivalTime = 'Check';
                            actualArrivalTime = 'Check at station';
                        }
                    } else {
                        arrivalTime = targetLocation.st;
                        const expectedTime = targetLocation.et;
                        
                        // Cache this journey time for estimating similar trains
                        if (departureTime && arrivalTime) {
                            const depTime = parseTime(departureTime);
                            const arrTime = parseTime(arrivalTime, departureTime);
                            if (depTime && arrTime) {
                                const journeyMs = arrTime - depTime;
                                const destName = service.destination?.[0]?.locationName || '';
                                const cacheKey = `${fromStation}-${toStation}-${destName}`;
                                journeyTimeCache.set(cacheKey, journeyMs);
                                console.log(`Cached journey time for ${cacheKey}: ${Math.round(journeyMs/60000)} mins`);
                            }
                        }
                        
                        // Handle arrival times with priority:
                        // 1. Use published delayed arrival time if available (e.g., "16:45")
                        // 2. If just "Delayed" without time, calculate based on journey duration
                        // 3. If "On time" or no update, use scheduled time
                        if (expectedTime && expectedTime !== 'On time' && expectedTime !== 'Delayed') {
                            // We have a specific updated arrival time (e.g., "16:45")
                            actualArrivalTime = expectedTime;
                        } else if (expectedTime === 'Delayed' || (service.etd === 'Delayed' && !expectedTime)) {
                            // Train is delayed but no specific arrival time given
                            // Calculate journey duration from scheduled times and apply to actual departure
                            const scheduledDep = parseTime(departureTime);
                            const scheduledArr = parseTime(arrivalTime, departureTime);
                            if (scheduledDep && scheduledArr) {
                                const journeyDurationMs = scheduledArr - scheduledDep;
                                const actualDep = parseTime(actualDepartureTime);
                                const estimatedArrival = new Date(actualDep.getTime() + journeyDurationMs);
                                actualArrivalTime = `${String(estimatedArrival.getHours()).padStart(2, '0')}:${String(estimatedArrival.getMinutes()).padStart(2, '0')}`;
                            } else {
                                actualArrivalTime = arrivalTime;
                            }
                        } else {
                            // On time or no update - use scheduled arrival time
                            actualArrivalTime = arrivalTime;
                        }
                    }
                }
                
                // Don't check previous calling points - those are stops already passed!
            }
        } catch (err) {
            console.warn('Could not fetch arrival time:', err);
        }
        
        // Skip trains that don't actually stop at destination
        if (skipTrain) continue;
        
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
            arrivalSecondsFromNow: (actualArrivalTime && actualArrivalTime !== 'Check at station' && !actualArrivalTime.includes('(est)')) ? 
                calculateSecondsUntil(actualArrivalTime.replace(/[~\s\(est\)]/g, '')) : 
                (actualArrivalTime && actualArrivalTime.includes('(est)') ? 
                    calculateSecondsUntil(actualArrivalTime.replace(/[~\s\(est\)]/g, '')) + 300 : null) // Add 5 mins penalty for estimated times in sorting
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
    
    // Save current direction to remember user's choice
    localStorage.setItem('trainDirection', currentDirection);
    
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
        
        if (train.actualArrivalTime === 'Check at station') {
            arrivalTimeEl.innerHTML = `<span style="font-size: 0.8em; opacity: 0.7;">Check at station</span>`;
        } else if (train.actualArrivalTime && train.actualArrivalTime.includes('(est)')) {
            arrivalTimeEl.innerHTML = `<span style="font-style: italic; opacity: 0.8;">${train.actualArrivalTime}</span>`;
        } else if (train.isDelayed && train.arrivalTime && train.arrivalTime !== train.actualArrivalTime) {
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