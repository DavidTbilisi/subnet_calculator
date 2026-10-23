"use strict";
// detect IP Class
const detectIpClass = function (ip) {
    const firstOctet = parseInt(ip.split('.')[0]);
    if (firstOctet >= 1 && firstOctet <= 126) {
        return 'A';
    }
    else if (firstOctet >= 128 && firstOctet <= 191) {
        return 'B';
    }
    else if (firstOctet >= 192 && firstOctet <= 223) {
        return 'C';
    }
    else if (firstOctet >= 224 && firstOctet <= 239) {
        return 'D';
    }
    else if (firstOctet >= 240 && firstOctet <= 255) {
        return 'E';
    }
    else {
        return 'Invalid IP';
    }
};
// four dot-separated octets, each 0-255
const isValidIp = function (ip) {
    const octets = ip.split('.');
    return octets.length === 4 && octets.every(octet => /^\d{1,3}$/.test(octet) && parseInt(octet) <= 255);
};
const classTypes = {
    A: 'Unicast',
    B: 'Unicast',
    C: 'Unicast',
    D: 'Multicast',
    E: 'Experimental',
};
// wire up the input
if (typeof document !== 'undefined') {
    const ipInput = document.getElementById('ip');
    const ipResult = document.getElementById('ip-result');
    ipInput.addEventListener('input', function () {
        const ip = ipInput.value.trim();
        if (ip === '') {
            ipResult.textContent = '';
            return;
        }
        const ipClass = isValidIp(ip) ? detectIpClass(ip) : 'Invalid IP';
        ipResult.textContent = ipClass in classTypes ? `Class ${ipClass} (${classTypes[ipClass]})` : ipClass;
    });
}
if (typeof module !== 'undefined') {
    module.exports = { detectIpClass };
}
