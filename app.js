import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCx9rr0SKJZW9CmLLpdmmUaFSrRN0b-t4s",
    authDomain: "pompe-baile-felix.firebaseapp.com",
    databaseURL: "https://pompe-baile-felix-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "pompe-baile-felix",
    storageBucket: "pompe-baile-felix.firebasestorage.app",
    messagingSenderId: "87522572818",
    appId: "1:87522572818:web:6c4f63645192cb5289f6cb",
    measurementId: "G-8DL6XREQVM"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

const sondaDevices = {
    1: [
        { id: 'pump_001', name: 'S1-V1', max: 30 },
        { id: 'pump_002', name: 'S2-V2', max: 65 },
    ],
    2: [
        { id: 'pump_003', name: 'S1-V1', max: 33 },
        { id: 'pump_004', name: 'S2-V2', max: 31 },
        { id: 'pump_005', name: 'S3-V3', max: 11 },
        { id: 'pump_006', name: 'S4-V4', max: 25 },
        { id: 'pump_007', name: 'S5-V5', max: 12 },
    ],
    3: [
        { id: 'pump_008', name: 'S1-V1', max: 65 },
        { id: 'pump_009', name: 'S2-V2', max: 20 },
        { id: 'pump_010', name: 'S3-V3', max: 15 },
    ]
};

const OFFLINE_THRESHOLD_MS = 60000;

// ── UI Elements ────────────────────────────────────────────────────────────
const sidebar        = document.getElementById('sidebar');
const overlay        = document.getElementById('overlay');
const hamburgerBtn   = document.getElementById('hamburgerBtn');
const sidebarClose   = document.getElementById('sidebarClose');
const topbarDevice   = document.getElementById('topbarDevice');
const controlCard    = document.getElementById('controlCard');
const placeholderMsg = document.getElementById('placeholderMessage');
const deviceTitle    = document.getElementById('currentDeviceTitle');
const sensorDisplay  = document.getElementById('sensorDisplay');
const valveDisplay   = document.getElementById('valveDisplay');
const valveInput     = document.getElementById('valveInput');
const setValveBtn    = document.getElementById('setValveBtn');
const emergencyBtn   = document.getElementById('emergencyBtn');
const errorMsg       = document.getElementById('errorMsg');
const statusBadge    = document.getElementById('statusBadge');
const cardsGrid      = document.getElementById('cardsGrid');
const espItems       = document.querySelectorAll('.esp-item');
const viewAllBtns    = document.querySelectorAll('.btn-view-all');

let unsubscribeSensor   = null;
let unsubscribeValve    = null;
let unsubscribeLastSeen = null;
let gridUnsubs          = [];
let currentDebitRef     = null;
let currentMax          = 71;
let lastSeenIntervals   = {};
let lastSeenValues      = {};

// Tracks which pump IDs currently have emergency active
const emergencyActive = new Set();

// ── Mobile sidebar toggle ──────────────────────────────────────────────────
function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('active');
}

function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
}

hamburgerBtn.addEventListener('click', openSidebar);
sidebarClose.addEventListener('click', closeSidebar);
overlay.addEventListener('click', closeSidebar);

function closeSidebarOnMobile() {
    if (window.innerWidth < 900) closeSidebar();
}

// ── Emergency helpers ──────────────────────────────────────────────────────

function activateEmergency(id, btnEl) {
    emergencyActive.add(id);
    btnEl.classList.add('active');
    btnEl.textContent = '⚠ Stop Urgență — ACTIV';
}

function deactivateEmergency(id, btnEl) {
    emergencyActive.delete(id);
    btnEl.classList.remove('active');
    btnEl.textContent = '⚠ Stop Urgență';
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isOnlineByLastSeen(id) {
    const lastSeen = lastSeenValues[id];
    if (!lastSeen) return false;
    return (Date.now() - lastSeen) < OFFLINE_THRESHOLD_MS;
}

function applyBadge(id, badgeEl) {
    const online        = isOnlineByLastSeen(id);
    badgeEl.textContent = online ? 'Online' : 'Offline';
    badgeEl.className   = 'status-badge ' + (online ? 'online' : 'offline');
}

function applyDot(id, dotEl) {
    if (!dotEl) return;
    dotEl.className = 'status-dot ' + (isOnlineByLastSeen(id) ? 'online' : 'offline');
}

function startLastSeenInterval(id, badgeEl, dotEl) {
    stopLastSeenInterval(id);
    lastSeenIntervals[id] = setInterval(() => {
        if (badgeEl) applyBadge(id, badgeEl);
        if (dotEl)   applyDot(id, dotEl);
    }, 5000);
}

function stopLastSeenInterval(id) {
    if (lastSeenIntervals[id]) {
        clearInterval(lastSeenIntervals[id]);
        delete lastSeenIntervals[id];
    }
}

function stopAllLastSeenIntervals() {
    Object.keys(lastSeenIntervals).forEach(id => stopLastSeenInterval(id));
}

function clearGridUnsubs() {
    gridUnsubs.forEach(fn => fn());
    gridUnsubs = [];
}

function hideAll() {
    placeholderMsg.style.display = 'none';
    controlCard.style.display    = 'none';
    cardsGrid.classList.remove('visible');
    espItems.forEach(i  => i.classList.remove('active'));
    viewAllBtns.forEach(b => b.classList.remove('active'));
    topbarDevice.textContent = 'Niciun dispozitiv';
}

function restartSidebarDotIntervals(activeEspId, activeBadgeEl) {
    espItems.forEach(item => {
        const id  = item.getAttribute('data-id');
        const dot = document.getElementById(`dot-${id}`);
        if (id === activeEspId && activeBadgeEl) {
            startLastSeenInterval(id, activeBadgeEl, dot);
        } else {
            startLastSeenInterval(id, null, dot);
        }
    });
}

// ── Sidebar status dots — subscribe on load ────────────────────────────────
espItems.forEach(item => {
    const espId       = item.getAttribute('data-id');
    const dot         = document.getElementById(`dot-${espId}`);
    const lastSeenRef = ref(db, `pumps/${espId}/last_seen`);

    onValue(lastSeenRef, snap => {
        const val = snap.val();
        if (typeof val === 'number') lastSeenValues[espId] = val;
        applyDot(espId, dot);
    });

    startLastSeenInterval(espId, null, dot);
});

// ── Single device view ─────────────────────────────────────────────────────
function selectESP(espId, espName, espMax, clickedEl) {
    clearGridUnsubs();
    stopAllLastSeenIntervals();
    if (unsubscribeSensor)   unsubscribeSensor();
    if (unsubscribeValve)    unsubscribeValve();
    if (unsubscribeLastSeen) unsubscribeLastSeen();

    hideAll();
    clickedEl.classList.add('active');
    controlCard.style.display = 'block';
    topbarDevice.textContent  = espName;
    currentMax                = espMax;

    deviceTitle.textContent   = espName;
    sensorDisplay.textContent = '--';
    valveDisplay.textContent  = '--';
    statusBadge.textContent   = '--';
    statusBadge.className     = 'status-badge';
    valveInput.value          = '';
    valveInput.max            = espMax;
    valveInput.placeholder    = `0 – ${espMax} m³/h`;
    errorMsg.textContent      = `Valoarea trebuie să fie între 0 și ${espMax}!`;
    errorMsg.style.display    = 'none';

    // Restore emergency button state for this device
    if (emergencyActive.has(espId)) {
        emergencyBtn.classList.add('active');
        emergencyBtn.textContent = '⚠ Stop Urgență — ACTIV';
    } else {
        emergencyBtn.classList.remove('active');
        emergencyBtn.textContent = '⚠ Stop Urgență';
    }

    const sensorRef   = ref(db, `pumps/${espId}/debit_sensor_percentage`);
    currentDebitRef   = ref(db, `pumps/${espId}/debit_target`);
    const lastSeenRef = ref(db, `pumps/${espId}/last_seen`);

    unsubscribeLastSeen = onValue(lastSeenRef, snap => {
        const val = snap.val();
        if (typeof val === 'number') lastSeenValues[espId] = val;
        applyBadge(espId, statusBadge);
        applyDot(espId, document.getElementById(`dot-${espId}`));
    });

    restartSidebarDotIntervals(espId, statusBadge);

    unsubscribeSensor = onValue(sensorRef, snap => {
        const data = snap.val();
        sensorDisplay.textContent = typeof data === 'number' ? data.toFixed(1) : '--';
    });

    unsubscribeValve = onValue(currentDebitRef, snap => {
        const data = snap.val();
        if (data !== null) {
            valveDisplay.textContent = data;
            // If debit_target is set to something > 0, deactivate emergency
            if (data > 0 && emergencyActive.has(espId)) {
                deactivateEmergency(espId, emergencyBtn);
            }
        }
    });

    closeSidebarOnMobile();
}

// ── Grid view ──────────────────────────────────────────────────────────────
function showAll(sondaNumber) {
    clearGridUnsubs();
    stopAllLastSeenIntervals();
    if (unsubscribeSensor)   unsubscribeSensor();
    if (unsubscribeValve)    unsubscribeValve();
    if (unsubscribeLastSeen) unsubscribeLastSeen();
    currentDebitRef = null;

    hideAll();
    document.querySelector(`.btn-view-all[data-sonda="${sondaNumber}"]`).classList.add('active');
    topbarDevice.textContent = `Sonda ${sondaNumber} — toate`;
    cardsGrid.innerHTML = '';
    cardsGrid.classList.add('visible');

    restartSidebarDotIntervals(null, null);

    sondaDevices[sondaNumber].forEach(({ id, name, max }) => {
        const card = document.createElement('div');
        card.className = 'grid-card';

        // Check if emergency is already active for this device
        const emergencyIsActive = emergencyActive.has(id);

        card.innerHTML = `
            <div class="grid-card-header">
                <span class="grid-card-name">${name}</span>
                <span class="status-badge" id="grid-badge-${id}">--</span>
            </div>
            <div class="grid-card-body">
                <div class="grid-metric-label">Senzor Debit</div>
                <div class="grid-metric-value" id="grid-sensor-${id}">--</div>
                <div class="grid-metric-unit">m³/h</div>
                <div class="grid-divider"></div>
                <div class="grid-valve-row">
                    <span class="grid-valve-label">Setare Debit</span>
                    <span class="grid-valve-value" id="grid-valve-${id}">--</span>
                </div>
                <div class="grid-input-row">
                    <input type="number" id="grid-input-${id}" min="0" max="${max}" placeholder="0 – ${max} m³/h">
                    <button class="btn-set" id="grid-btn-${id}">Setează</button>
                </div>
                <button class="btn-emergency ${emergencyIsActive ? 'active' : ''}" id="grid-emergency-${id}">
                    ⚠ Stop Urgență${emergencyIsActive ? ' — ACTIV' : ''}
                </button>
                <div class="grid-error-msg" id="grid-err-${id}">Valoarea trebuie să fie între 0 și ${max}!</div>
            </div>
        `;
        cardsGrid.appendChild(card);

        const badgeEl     = document.getElementById(`grid-badge-${id}`);
        const sensorEl    = document.getElementById(`grid-sensor-${id}`);
        const valveEl     = document.getElementById(`grid-valve-${id}`);
        const dot         = document.getElementById(`dot-${id}`);
        const emergencyEl = document.getElementById(`grid-emergency-${id}`);

        const sensorRef   = ref(db, `pumps/${id}/debit_sensor_percentage`);
        const debitRef    = ref(db, `pumps/${id}/debit_target`);
        const lastSeenRef = ref(db, `pumps/${id}/last_seen`);

        const u3 = onValue(lastSeenRef, snap => {
            const val = snap.val();
            if (typeof val === 'number') lastSeenValues[id] = val;
            applyBadge(id, badgeEl);
            applyDot(id, dot);
        });

        startLastSeenInterval(id, badgeEl, dot);

        const u1 = onValue(sensorRef, snap => {
            const data = snap.val();
            sensorEl.textContent = typeof data === 'number' ? data.toFixed(1) : '--';
        });

        const u2 = onValue(debitRef, snap => {
            const data = snap.val();
            if (data !== null) {
                valveEl.textContent = data;
                // If debit_target goes above 0, deactivate emergency for this card
                if (data > 0 && emergencyActive.has(id)) {
                    deactivateEmergency(id, emergencyEl);
                }
            }
        });

        gridUnsubs.push(u1, u2, u3);

        // Setează button — also deactivates emergency
        document.getElementById(`grid-btn-${id}`).addEventListener('click', () => {
            const input    = document.getElementById(`grid-input-${id}`);
            const errEl    = document.getElementById(`grid-err-${id}`);
            const btn      = document.getElementById(`grid-btn-${id}`);
            const newValue = parseInt(input.value);

            if (isNaN(newValue) || newValue < 0 || newValue > max) {
                errEl.style.display = 'block';
                return;
            }
            errEl.style.display = 'none';
            set(debitRef, newValue);
            if (newValue > 0) deactivateEmergency(id, emergencyEl);
            input.value  = '';
            btn.disabled = true;
            setTimeout(() => { btn.disabled = false; }, 1000);
        });

        // Stop Urgență button
        emergencyEl.addEventListener('click', () => {
            set(debitRef, 0);
            activateEmergency(id, emergencyEl);
        });
    });

    closeSidebarOnMobile();
}

// ── Event listeners ────────────────────────────────────────────────────────
espItems.forEach(item => {
    item.addEventListener('click', function () {
        const espMax = parseInt(this.getAttribute('data-max'));
        selectESP(this.getAttribute('data-id'), this.getAttribute('data-name'), espMax, this);
    });
});

viewAllBtns.forEach(btn => {
    btn.addEventListener('click', function () {
        showAll(parseInt(this.getAttribute('data-sonda')));
    });
});

setValveBtn.addEventListener('click', () => {
    if (!currentDebitRef) return;
    const newValue = parseInt(valveInput.value);
    if (isNaN(newValue) || newValue < 0 || newValue > currentMax) {
        errorMsg.style.display = 'block';
        return;
    }
    errorMsg.style.display = 'none';
    set(currentDebitRef, newValue);
    valveInput.value     = '';
    setValveBtn.disabled = true;
    setTimeout(() => { setValveBtn.disabled = false; }, 1000);
});

// Stop Urgență — single device view
emergencyBtn.addEventListener('click', () => {
    if (!currentDebitRef) return;
    // Find the current espId from the active esp-item
    const activeItem = document.querySelector('.esp-item.active');
    if (!activeItem) return;
    const espId = activeItem.getAttribute('data-id');
    set(currentDebitRef, 0);
    activateEmergency(espId, emergencyBtn);
});