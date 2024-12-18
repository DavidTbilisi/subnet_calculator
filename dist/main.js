"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectIpClass = void 0;
const ip = '10.10.1.1';
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
exports.detectIpClass = detectIpClass;
