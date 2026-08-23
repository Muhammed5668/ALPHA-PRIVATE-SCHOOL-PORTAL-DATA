// =============================================================================
// DATABASE.JS — Alpha Portal · State & Data Management
// =============================================================================

const ADMIN_USERNAME = "ADMIN";
// Secure Salted Hashes for System Defaults (so plain text passwords are never stored)
const ADMIN_PASSWORD_SALT = "SystemAdminDefaultSalt2026!";
let ADMIN_PASSWORD_HASH = ""; // Initialized below dynamically after db_hashPassword helper is declared
const DEFAULT_STUDENT_PASSWORD_HASH = "a6042db62bda7ca47bc6386ff0b6667fe4dbdfcbba28b2649b3806fb4dbbcdae"; // Hashed representation of "alphastudent12345"
const DEFAULT_TEACHER_PASSWORD_HASH = "90c9b0e3be538dfeb3c267b2fc2f0bcba8919f8eb2f7c00609cc5b1d47631320"; // Hashed representation of "alphateacher12345"
const DEFAULT_PARENT_PASSWORD_HASH = "8a25c116ba58d8c2780e5509939fe88c7f0dbdf4be2b81498b87e9140fb5be3c"; // Hashed representation of "alphaperent12345"

// Plain-text helper strings for registration placeholders ONLY (if user has not customized them)
const DEFAULT_STUDENT_PASSWORD_PLAIN = "alphastudent12345";
const DEFAULT_TEACHER_PASSWORD_PLAIN = "alphateacher12345";
const DEFAULT_PARENT_PASSWORD_PLAIN  = "alphaperent12345";

const DEFAULT_STUDENT_PASSWORD = DEFAULT_STUDENT_PASSWORD_PLAIN;
const DEFAULT_TEACHER_PASSWORD = DEFAULT_TEACHER_PASSWORD_PLAIN;
const DEFAULT_PARENT_PASSWORD  = DEFAULT_PARENT_PASSWORD_PLAIN;

let stateDatabase = JSON.parse(localStorage.getItem('alpha_portal_storage')) || {
    students: [],
    teachers: [],
    announcements: [],
    chatMessages: {},
    classChatMessages: {},
    uploadedMaterials: [],
    assignedHomework: [],
    postedReports: [],
    subjects: [],
    chapters: [],
    homeAssignments: [],
    auditLogs: [],
    attendance: [],
    attendanceFrozen: false,
    attendanceFreezeLog: []
};

// Initialize Principal Suite Default Stores if missing
if (!stateDatabase.leaveRequests) {
    stateDatabase.leaveRequests = [
        { id: 'LV-101', applicantName: 'Sarah Jenkins', role: 'Mathematics Teacher', dates: '2026-08-01 to 2026-08-03', type: 'Medical', reason: 'Minor surgical procedure', status: 'Pending' },
        { id: 'LV-102', applicantName: 'Robert Vance', role: 'Science Dept Head', dates: '2026-08-10 to 2026-08-12', type: 'Casual', reason: 'Family engagement', status: 'Approved' }
    ];
}
if (!stateDatabase.budgetRequests) {
    stateDatabase.budgetRequests = [
        { id: 'BG-301', department: 'Science Lab', title: 'Digital Microscopes Procurement', amount: 3450, requestedBy: 'Dr. Evelyn Reed', status: 'Pending' },
        { id: 'BG-302', department: 'Physical Education', title: 'Annual Sports Day Equipment', amount: 1800, requestedBy: 'Coach Marcus Vance', status: 'Approved' }
    ];
}
if (!stateDatabase.gradeModifications) {
    stateDatabase.gradeModifications = [
        { id: 'GM-501', teacherName: 'Sarah Jenkins', studentName: 'Alexander Hayes', subject: 'Grade 10 Mathematics', originalGrade: '68% (C)', proposedGrade: '78% (B)', reason: 'Re-evaluated re-take exam section III', status: 'Pending' }
    ];
}
if (!stateDatabase.observationLogs) {
    stateDatabase.observationLogs = [
        { id: 'OB-201', teacherName: 'Sarah Jenkins', subject: 'Mathematics', date: '2026-07-20', score: 4.8, notes: 'Excellent student engagement and clear board demonstrations on quadratic functions.', recommendations: 'Integrate interactive graphing tool for visual learners.' }
    ];
}
if (!stateDatabase.teacherKPIs) {
    stateDatabase.teacherKPIs = {
        'TCH-001': { punctuality: 98, lessonCompletion: 95, passRate: 92, rating: 4.8, pdCertifications: ['STEM Pedagogy 2025', 'Digital Assessment Mastery'] }
    };
}
if (!stateDatabase.emergencyBroadcasts) {
    stateDatabase.emergencyBroadcasts = [];
}
if (!stateDatabase.campusIncidents) {
    stateDatabase.campusIncidents = [
        { id: 'INC-901', studentName: 'Liam Carter', category: 'Medical Clinic', date: '2026-07-22', details: 'Slight knee abrasion during recess physical activity. Treated by school nurse.', status: 'Resolved' }
    ];
}
if (!stateDatabase.curriculumSyllabus) {
    stateDatabase.curriculumSyllabus = [
        { id: 'SYL-01', subject: 'Mathematics', grade: 'Grade 10', teacherName: 'Sarah Jenkins', completedChapters: 8, totalChapters: 10, status: 'On Track' },
        { id: 'SYL-02', subject: 'Physics', grade: 'Grade 11', teacherName: 'Dr. Evelyn Reed', completedChapters: 5, totalChapters: 12, status: 'Behind Schedule' }
    ];
}
if (!stateDatabase.feeCollections) {
    stateDatabase.feeCollections = [
        { grade: 'Grade 10', totalStudents: 32, feePerStudent: 5000, collected: 145000, pending: 15000 },
        { grade: 'Grade 11', totalStudents: 28, feePerStudent: 5500, collected: 132000, pending: 22000 }
    ];
}
if (!stateDatabase.facilityMaintenance) {
    stateDatabase.facilityMaintenance = [
        { id: 'MNT-401', asset: 'School Bus #04', issue: 'Brake fluid service and tire replacement', priority: 'High', status: 'In Progress' },
        { id: 'MNT-402', asset: 'Computer Lab B', issue: 'Projector bulb replacement in Station 12', priority: 'Medium', status: 'Pending' }
    ];
}
if (!stateDatabase.townHalls) {
    stateDatabase.townHalls = [
        { id: 'TH-101', topic: 'Term 1 Curriculum & Academic Roadmap', date: '2026-08-15', time: '17:00', location: 'Main Auditorium & Live Stream', rsvpCount: 42, status: 'Scheduled' }
    ];
}
if (!stateDatabase.masterEvents) {
    stateDatabase.masterEvents = [
        { id: 'EV-801', title: 'Annual Inter-School STEM Fair', category: 'Science Fair', startDate: '2026-08-25', endDate: '2026-08-26', status: 'Approved' },
        { id: 'EV-802', title: 'Term 1 Mid-Term Examinations', category: 'Exam', startDate: '2026-09-10', endDate: '2026-09-18', status: 'Approved' }
    ];
}
if (!stateDatabase.vipVisits) {
    stateDatabase.vipVisits = [
        { id: 'VIP-01', visitorName: 'Dr. Tariq Al-Mansoor', organization: 'Ministry of Education Inspectorate', date: '2026-08-05', purpose: 'Annual Quality & Curriculum Inspection', escort: 'School Principal', status: 'Upcoming' }
    ];
}

if (!stateDatabase.attendanceFreezeLog) {
    stateDatabase.attendanceFreezeLog = [];
}
if (stateDatabase.attendanceFrozen === undefined) {
    stateDatabase.attendanceFrozen = false;
}

// --- SYNCHRONOUS SECURE SHA-256 CRYPTO ENGINE ---
function sha256(ascii) {
    function rightRotate(value, amount) {
        return (value >>> amount) | (value << (32 - amount));
    }
    var words = [];
    var asciiLength = ascii.length;
    var i, j;
    for (i = 0; i < asciiLength * 8; i += 8) {
        words[i >> 5] |= (ascii.charCodeAt(i / 8) & 0xff) << (24 - i % 32);
    }
    words[asciiLength >> 2] |= 0x80 << (24 - (asciiLength % 4) * 8);
    words[((asciiLength + 8) >> 6 << 4) + 15] = asciiLength * 8;
    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
        h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var k = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    for (i = 0; i < words.length; i += 16) {
        var w = words.slice(i, i + 16);
        while (w.length < 64) {
            var s0 = rightRotate(w[w.length - 15], 7) ^ rightRotate(w[w.length - 15], 18) ^ (w[w.length - 15] >>> 3);
            var s1 = rightRotate(w[w.length - 2], 17) ^ rightRotate(w[w.length - 2], 19) ^ (w[w.length - 2] >>> 10);
            w.push((w[w.length - 16] + s0 + w[w.length - 7] + s1) | 0);
        }
        var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (j = 0; j < 64; j++) {
            var S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
            var ch = (e & f) ^ (~e & g);
            var temp1 = (h + S1 + ch + k[j] + w[j]) | 0;
            var S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
            var maj = (a & b) ^ (a & c) ^ (b & c);
            var temp2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map(function (v) {
        return (v >>> 0).toString(16).padStart(8, '0');
    }).join('');
}

function db_hashPassword(password, salt) {
    let hash = password;
    const iterations = 1000; // Key stretching of 1000 iterations
    for (let i = 0; i < iterations; i++) {
        hash = sha256(hash + salt + "AlphaSecurePortalSaltExtension!");
    }
    return hash;
}

// Generates a brand-new random password, hashes+salts it for storage, and
// returns the plaintext ONCE so the admin can relay it to the student/teacher.
// Nothing is ever written to storage in plaintext.
function db_generateResetPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let pwd = '';
    for (let i = 0; i < 8; i++) {
        pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd;
}

function db_resetStudentPassword(studentId, actorId) {
    const s = stateDatabase.students.find(x => x.id === studentId);
    if (!s) return null;
    const newPwd = db_generateResetPassword();
    const salt = "SALT-" + Math.floor(Math.random() * 1000000);
    s.password = { hash: db_hashPassword(newPwd, salt), salt: salt };
    saveState();
    db_logEvent(actorId || 'admin', 'Admin', 'Password Reset', `Password reset for student ${s.name} (${s.id}).`);
    return newPwd;
}

function db_resetTeacherPassword(teacherId, actorId) {
    const t = stateDatabase.teachers.find(x => x.id === teacherId);
    if (!t) return null;
    const newPwd = db_generateResetPassword();
    const salt = "SALT-" + Math.floor(Math.random() * 1000000);
    t.password = { hash: db_hashPassword(newPwd, salt), salt: salt };
    saveState();
    db_logEvent(actorId || 'admin', 'Admin', 'Password Reset', `Password reset for teacher ${t.name} (${t.id}).`);
    return newPwd;
}

// Dynamically hash the custom admin password "123456" with safety salt stretching
ADMIN_PASSWORD_HASH = stateDatabase.adminPasswordHash || db_hashPassword("123456", ADMIN_PASSWORD_SALT);

// SECURE AUDIT LOGGER
function db_logEvent(user, role, action, details) {
    if (!stateDatabase.auditLogs) stateDatabase.auditLogs = [];
    stateDatabase.auditLogs.unshift({
        id: "LOG-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
        timestamp: new Date().toISOString(),
        user: user || 'Anonymous',
        role: role || 'Public',
        action: action,
        details: details || '',
        ip: '127.0.0.1'
    });
    // Keep last 500 logs for performance
    if (stateDatabase.auditLogs.length > 500) {
        stateDatabase.auditLogs = stateDatabase.auditLogs.slice(0, 500);
    }
    saveState();
}

function saveState() {
    localStorage.setItem('alpha_portal_storage', JSON.stringify(stateDatabase));
}

// =============================================================================
// INDEXEDDB FILE STORAGE ENGINE (For 100k+ Documents & Heavy Media)
// =============================================================================
const dbName = "AlphaPortalFilesDB";
const storeName = "files";
let idb = null;

function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName);
            }
        };
        request.onsuccess = (e) => {
            idb = e.target.result;
            resolve(idb);
        };
        request.onerror = (e) => {
            console.error("IndexedDB failed to open:", e.target.error);
            reject(e.target.error);
        };
    });
}

function saveFileToIndexedDB(key, data) {
    return new Promise((resolve, reject) => {
        if (!idb) {
            initIndexedDB().then(() => saveFileToIndexedDB(key, data).then(resolve).catch(reject))
                           .catch(reject);
            return;
        }
        const tx = idb.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        store.put(data, key);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

function getFileFromIndexedDB(key) {
    return new Promise((resolve, reject) => {
        if (!idb) {
            initIndexedDB().then(() => getFileFromIndexedDB(key).then(resolve).catch(reject))
                           .catch(reject);
            return;
        }
        const tx = idb.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

function deleteFileFromIndexedDB(key) {
    return new Promise((resolve, reject) => {
        if (!idb) {
            initIndexedDB().then(() => deleteFileFromIndexedDB(key).then(resolve).catch(reject))
                           .catch(reject);
            return;
        }
        const tx = idb.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

// Global downloader helper for IndexedDB file assets
async function downloadFileAsset(id, fileName) {
    try {
        const data = await getFileFromIndexedDB(id);
        if (!data) {
            alert("This document is not stored in your local offline browser database. If it was uploaded on another device, please synchronize or re-upload.");
            return;
        }
        const link = document.createElement('a');
        if (data instanceof Blob) {
            const url = URL.createObjectURL(data);
            link.href = url;
            link.onload = () => URL.revokeObjectURL(url);
        } else {
            link.href = data; // Data URL string
        }
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        console.error("Error downloading file:", err);
        alert("An error occurred while downloading this document.");
    }
}

// Global lazy-loader for IndexedDB images & avatars
function lazyLoadAllImages() {
    const lazyImages = document.querySelectorAll('img[data-id]');
    lazyImages.forEach(img => {
        const id = img.getAttribute('data-id');
        const fallback = img.getAttribute('data-fallback');
        if (id) {
            getFileFromIndexedDB(id).then(data => {
                if (data) {
                    img.src = data;
                } else if (fallback) {
                    img.src = fallback;
                }
                img.removeAttribute('data-id');
            }).catch(e => {
                if (fallback) img.src = fallback;
                console.error("Failed to load image from IDB:", e);
            });
        }
    });
}

// Initialize IndexedDB immediately on load
initIndexedDB().then(() => {
    console.log("🎒 IndexedDB File System initialized.");
    lazyLoadAllImages();
}).catch(err => {
    console.error("❌ IndexedDB failover:", err);
});

/* ---- Student helpers ---- */
function db_addStudent(obj) {
    if (obj.password && typeof obj.password === 'string') {
        const plainText = obj.password;
        const salt = "SALT-" + Math.floor(Math.random() * 1000000);
        obj.password = { hash: db_hashPassword(plainText, salt), salt: salt };
    }
    stateDatabase.students.push(obj);
    saveState();
}
function db_deleteStudent(id)     { stateDatabase.students = stateDatabase.students.filter(s => s.id !== id); saveState(); }
function db_getStudent(id)        { return stateDatabase.students.find(s => s.id === id) || null; }
function db_sectionsMatch(sec1, sec2) { if (!sec1 || !sec2) return false; return sec1.replace('Section ', '').trim().toUpperCase() === sec2.replace('Section ', '').trim().toUpperCase(); }
function db_getStudents(g, sec)   { return stateDatabase.students.filter(s => s.grade === g && db_sectionsMatch(s.section, sec)); }

/* ---- Teacher helpers ---- */
function db_addTeacher(obj) {
    if (obj.password && typeof obj.password === 'string') {
        const plainText = obj.password;
        const salt = "SALT-" + Math.floor(Math.random() * 1000000);
        obj.password = { hash: db_hashPassword(plainText, salt), salt: salt };
    }
    stateDatabase.teachers.push(obj);
    saveState();
}
function db_deleteTeacher(id)     { stateDatabase.teachers = stateDatabase.teachers.filter(t => t.id !== id); saveState(); }
function db_getTeacher(id)        { return stateDatabase.teachers.find(t => t.id === id) || null; }

/* ---- Announcement helpers ---- */
function db_addAnnouncement(obj)  { if (!stateDatabase.announcements) stateDatabase.announcements = []; stateDatabase.announcements.push(obj); saveState(); }

/* ---- Materials / Home Assignment helpers ---- */
function db_addSubject(grade, section, name) {
    if (!stateDatabase.subjects) stateDatabase.subjects = [];
    if (stateDatabase.subjects.some(s => s.grade === grade && db_sectionsMatch(s.section, section) && s.name.toLowerCase() === name.toLowerCase())) {
        return null;
    }
    const id = "SUB-" + Math.floor(100000 + Math.random() * 900000);
    const newSubject = { id, grade, section, name };
    stateDatabase.subjects.push(newSubject);
    saveState();
    return newSubject;
}
function db_getSubjects(grade, section) {
    if (!stateDatabase.subjects) stateDatabase.subjects = [];
    return stateDatabase.subjects.filter(s => s.grade === grade && db_sectionsMatch(s.section, section));
}
function db_deleteSubject(id) {
    if (!stateDatabase.subjects) stateDatabase.subjects = [];
    stateDatabase.subjects = stateDatabase.subjects.filter(s => s.id !== id);
    if (stateDatabase.chapters) {
        stateDatabase.chapters.forEach(c => {
            if (c.subjectId === id) db_deleteChapter(c.id);
        });
    }
    saveState();
}

function db_addChapter(subjectId, name) {
    if (!stateDatabase.chapters) stateDatabase.chapters = [];
    if (stateDatabase.chapters.some(c => c.subjectId === subjectId && c.name.toLowerCase() === name.toLowerCase())) {
        return null;
    }
    const id = "CHAP-" + Math.floor(100000 + Math.random() * 900000);
    const newChapter = { id, subjectId, name };
    stateDatabase.chapters.push(newChapter);
    saveState();
    return newChapter;
}
function db_getChapters(subjectId) {
    if (!stateDatabase.chapters) stateDatabase.chapters = [];
    return stateDatabase.chapters.filter(c => c.subjectId === subjectId);
}
function db_deleteChapter(id) {
    if (!stateDatabase.chapters) stateDatabase.chapters = [];
    stateDatabase.chapters = stateDatabase.chapters.filter(c => c.id !== id);
    if (stateDatabase.homeAssignments) {
        stateDatabase.homeAssignments = stateDatabase.homeAssignments.filter(a => a.chapterId !== id);
    }
    saveState();
}

function db_addHomeAssignment(obj) {
    if (!stateDatabase.homeAssignments) stateDatabase.homeAssignments = [];
    const fileData = obj.fileData;
    if (fileData) {
        saveFileToIndexedDB(obj.id, fileData).catch(err => console.error("IDB Save Error:", err));
        obj.fileData = ""; // Clear from localStorage state
        obj.hasFile = true;
    }
    stateDatabase.homeAssignments.push(obj);
    saveState();
}
function db_getHomeAssignments(chapterId) {
    if (!stateDatabase.homeAssignments) stateDatabase.homeAssignments = [];
    return stateDatabase.homeAssignments.filter(a => a.chapterId === chapterId);
}
function db_deleteHomeAssignment(id) {
    if (!stateDatabase.homeAssignments) stateDatabase.homeAssignments = [];
    stateDatabase.homeAssignments = stateDatabase.homeAssignments.filter(a => a.id !== id);
    deleteFileFromIndexedDB(id).catch(err => console.error("IDB Delete Error:", err));
    saveState();
}

/* ---- Homework helpers (legacy) ---- */
function db_addHomework(obj) {
    if (!stateDatabase.assignedHomework) stateDatabase.assignedHomework = [];
    const image = obj.image;
    if (image) {
        saveFileToIndexedDB(obj.id, image).catch(err => console.error("IDB Save Error:", err));
        obj.image = ""; // Clear from localStorage state
        obj.hasImage = true;
    }
    stateDatabase.assignedHomework.push(obj);
    saveState();
}
function db_getHomework(g, sec)   { if (!stateDatabase.assignedHomework) return []; return stateDatabase.assignedHomework.filter(h => h.grade === g && db_sectionsMatch(h.section, sec)); }

/* ---- Report helpers ---- */
function db_addReport(obj) {
    if (!stateDatabase.postedReports) stateDatabase.postedReports = [];
    const fileData = obj.fileData;
    if (fileData) {
        saveFileToIndexedDB(obj.id, fileData).catch(err => console.error("IDB Save Error:", err));
        obj.fileData = ""; // Clear from localStorage state
        obj.hasFile = true;
    }
    stateDatabase.postedReports.push(obj);
    saveState();
}
function db_getReports(sid)       { if (!stateDatabase.postedReports) return []; return stateDatabase.postedReports.filter(r => r.studentId === sid); }

/* ---- Chat helpers ---- */
function db_addChatMessage(key, msg) {
    if (!stateDatabase.chatMessages) stateDatabase.chatMessages = {};
    if (!stateDatabase.chatMessages[key]) stateDatabase.chatMessages[key] = [];
    
    if (!msg.id) {
        msg.id = "MSG-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    }
    
    if (msg.type === 'image' && msg.content) {
        saveFileToIndexedDB(msg.id, msg.content).catch(err => console.error("IDB Save Error:", err));
        msg.content = ""; // Clear from localStorage state
        msg.hasImage = true;
    }
    
    stateDatabase.chatMessages[key].push(msg);
    saveState();
}
function db_getMessages(key) {
    if (!stateDatabase.chatMessages) stateDatabase.chatMessages = {};
    return stateDatabase.chatMessages[key] || [];
}

/* ---- Class group chat (all students of a grade+section + their teachers) ---- */
function db_classChatKey(grade, section) {
    const sec = (section || '').replace('Section ', '').trim().toUpperCase();
    return `CLASS-${grade}-${sec}`;
}
function db_addClassChatMessage(grade, section, msg) {
    const key = db_classChatKey(grade, section);
    if (!stateDatabase.classChatMessages) stateDatabase.classChatMessages = {};
    if (!stateDatabase.classChatMessages[key]) stateDatabase.classChatMessages[key] = [];

    if (!msg.id) {
        msg.id = "CMSG-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    }

    if (msg.type === 'image' && msg.content) {
        saveFileToIndexedDB(msg.id, msg.content).catch(err => console.error("IDB Save Error:", err));
        msg.content = "";
        msg.hasImage = true;
    }

    stateDatabase.classChatMessages[key].push(msg);
    saveState();
}
function db_getClassChatMessages(grade, section) {
    const key = db_classChatKey(grade, section);
    if (!stateDatabase.classChatMessages) stateDatabase.classChatMessages = {};
    return stateDatabase.classChatMessages[key] || [];
}

/* ---- Viewed / Unviewed Home Assignment Notification helpers ---- */
function db_markChapterAssignmentsAsViewed(studentId, chapterId) {
    if (!stateDatabase.viewedAssignments) stateDatabase.viewedAssignments = {};
    if (!stateDatabase.viewedAssignments[studentId]) stateDatabase.viewedAssignments[studentId] = [];
    const assignments = db_getHomeAssignments(chapterId);
    assignments.forEach(a => {
        if (!stateDatabase.viewedAssignments[studentId].includes(a.id)) {
            stateDatabase.viewedAssignments[studentId].push(a.id);
        }
    });
    saveState();
}

function db_isAssignmentViewed(studentId, assignmentId) {
    if (!stateDatabase.viewedAssignments) return false;
    if (!stateDatabase.viewedAssignments[studentId]) return false;
    return stateDatabase.viewedAssignments[studentId].includes(assignmentId);
}

function db_getUnviewedAssignmentsCountForChapter(studentId, chapterId) {
    const assignments = db_getHomeAssignments(chapterId);
    let count = 0;
    assignments.forEach(a => {
        if (!db_isAssignmentViewed(studentId, a.id)) {
            count++;
        }
    });
    return count;
}

function db_getUnviewedAssignmentsCountForSubject(studentId, subjectId) {
    const chapters = db_getChapters(subjectId);
    let count = 0;
    chapters.forEach(c => {
        count += db_getUnviewedAssignmentsCountForChapter(studentId, c.id);
    });
    return count;
}

function db_getUnviewedAssignmentsCountTotal(studentId, grade, section) {
    const subjects = db_getSubjects(grade, section);
    let count = 0;
    subjects.forEach(s => {
        count += db_getUnviewedAssignmentsCountForSubject(studentId, s.id);
    });
    return count;
}

/* ---- Attendance Tracking Helpers ---- */
function db_saveAttendance(studentId, date, status, remarks, teacherId) {
    if (!stateDatabase.attendance) stateDatabase.attendance = [];
    
    const existingIndex = stateDatabase.attendance.findIndex(
        r => r.studentId === studentId && r.date === date
    );
    
    const record = {
        studentId,
        date,
        status, // 'Present', 'Absent', 'Late', 'Excused'
        remarks: remarks || '',
        markedBy: teacherId,
        timestamp: new Date().toISOString()
    };
    
    if (existingIndex !== -1) {
        stateDatabase.attendance[existingIndex] = record;
    } else {
        stateDatabase.attendance.push(record);
    }
    saveState();
    return record;
}

function db_getAttendanceForClass(grade, section, date) {
    if (!stateDatabase.attendance) stateDatabase.attendance = [];
    const studentIds = stateDatabase.students
        .filter(s => s.grade === grade && db_sectionsMatch(s.section, section))
        .map(s => s.id);
        
    return stateDatabase.attendance.filter(
        r => r.date === date && studentIds.includes(r.studentId)
    );
}

function db_getAttendanceForStudent(studentId) {
    if (!stateDatabase.attendance) stateDatabase.attendance = [];
    return stateDatabase.attendance.filter(r => r.studentId === studentId);
}

/* ── School-Wide Attendance Freeze ──
   When frozen: teachers cannot mark/edit attendance for any class, and every
   date inside a frozen period is excluded from attendance rate calculations
   entirely (it simply never counts, the same way a weekend doesn't). This is
   tracked as a log of freeze/resume events so multiple freeze periods over
   the school year are all remembered accurately, not just the current one. */

function db_isAttendanceCurrentlyFrozen() {
    return !!stateDatabase.attendanceFrozen;
}

function db_freezeAttendance(adminId) {
    if (!stateDatabase.attendanceFreezeLog) stateDatabase.attendanceFreezeLog = [];
    stateDatabase.attendanceFrozen = true;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = `${db_todayISOInternal()} ${timeStr}`;
    const actor = adminId || 'admin';
    stateDatabase.attendanceFreezeLog.push({ date: dateStr, action: 'freeze', by: actor });
    saveState();
    db_logEvent(actor, 'Admin', 'Attendance Frozen', `School-wide attendance marking frozen starting ${dateStr}. Teachers cannot mark attendance and no days will count until resumed.`);
    return true;
}

function db_resumeAttendance(adminId) {
    if (!stateDatabase.attendanceFreezeLog) stateDatabase.attendanceFreezeLog = [];
    stateDatabase.attendanceFrozen = false;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = `${db_todayISOInternal()} ${timeStr}`;
    const actor = adminId || 'admin';
    stateDatabase.attendanceFreezeLog.push({ date: dateStr, action: 'resume', by: actor });
    saveState();
    db_logEvent(actor, 'Admin', 'Attendance Resumed', `School-wide attendance marking resumed as of ${dateStr}.`);
    return true;
}

// Walks the freeze/resume log to determine whether a given "YYYY-MM-DD" date
// falls inside any frozen period (handles multiple freeze cycles correctly).
function db_isDateFrozen(dateStr) {
    const log = stateDatabase.attendanceFreezeLog || [];
    let frozen = false;
    let frozenStart = null;
    for (let i = 0; i < log.length; i++) {
        const entry = log[i];
        if (entry.action === 'freeze') {
            frozen = true;
            frozenStart = entry.date;
        } else if (entry.action === 'resume') {
            if (frozen && frozenStart && dateStr >= frozenStart && dateStr < entry.date) return true;
            frozen = false;
            frozenStart = null;
        }
    }
    // Still frozen with no matching resume yet — covers from freeze start through today.
    if (frozen && frozenStart && dateStr >= frozenStart) return true;
    return false;
}

// Local ISO-date helper so database.js doesn't depend on app.js's todayISO().
function db_todayISOInternal() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * A student's attendance rate, computed purely from explicit records the
 * teacher actually saved. A day with no record simply isn't counted — there
 * is no guessing, no HTML parsing, no ambiguity. This is the single source
 * of truth for "how present has this student been."
 */
function db_getAttendanceRate(studentId) {
    const records = db_getAttendanceForStudent(studentId);
    let present = 0;
    const total = records.length;
    records.forEach(r => {
        if (r.status === 'Present' || r.status === 'Late' || r.status === 'Excused') present++;
    });
    const rawPercentage = total > 0 ? (present / total) * 100 : 100;
    return {
        present,
        total,
        rawPercentage,
        percentage: rawPercentage.toFixed(1) + '%'
    };
}

/** Live counts for a single class on a single day, for the teacher's summary bar. */
function db_getClassAttendanceSummary(grade, section, date) {
    const students = db_getStudents(grade, section);
    const records = db_getAttendanceForClass(grade, section, date);
    const byStudent = {};
    records.forEach(r => { byStudent[r.studentId] = r.status; });

    const summary = { total: students.length, present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 };
    students.forEach(s => {
        const status = byStudent[s.id];
        if (status === 'Present') summary.present++;
        else if (status === 'Absent') summary.absent++;
        else if (status === 'Late') summary.late++;
        else if (status === 'Excused') summary.excused++;
        else summary.unmarked++;
    });
    return summary;
}

/** Wipes every attendance record for one class on one date (used by "Clear Day"). */
function db_clearAttendanceForClassDate(grade, section, date) {
    if (!stateDatabase.attendance) stateDatabase.attendance = [];
    const studentIds = stateDatabase.students
        .filter(s => s.grade === grade && db_sectionsMatch(s.section, section))
        .map(s => s.id);
    stateDatabase.attendance = stateDatabase.attendance.filter(
        r => !(r.date === date && studentIds.includes(r.studentId))
    );
    saveState();
}

/**
 * Whole-school attendance snapshot for the Principal's dashboard: every
 * student with their present/total/rate, sorted worst-attendance-first so
 * the students who need attention surface immediately.
 */
function db_getSchoolAttendanceOverview() {
    const students = stateDatabase.students || [];
    const rows = students.map(s => {
        const rate = db_getAttendanceRate(s.id);
        return {
            studentId: s.id,
            name: s.name,
            grade: s.grade,
            section: s.section,
            roll: s.roll,
            present: rate.present,
            total: rate.total,
            rawPercentage: rate.rawPercentage,
            percentage: rate.percentage
        };
    });
    rows.sort((a, b) => a.rawPercentage - b.rawPercentage);

    const withRecords = rows.filter(r => r.total > 0);
    const avgRate = withRecords.length > 0
        ? withRecords.reduce((sum, r) => sum + r.rawPercentage, 0) / withRecords.length
        : 100;

    return {
        students: rows,
        schoolAverageRate: avgRate,
        studentsBelow75: withRecords.filter(r => r.rawPercentage < 75).length,
        studentsBelow90: withRecords.filter(r => r.rawPercentage < 90).length,
        studentsWithNoRecords: rows.length - withRecords.length
    };
}

// SECURITY AUTO-UPGRADE LOGIC FOR LEGACY PLAINTEXT PASSWORDS
function db_secureExistingPlaintextPasswords() {
    let upgradedCount = 0;
    if (stateDatabase.students) {
        stateDatabase.students.forEach(s => {
            if (s.password && typeof s.password === 'string') {
                const plainText = s.password;
                const salt = "SALT-" + Math.floor(Math.random() * 1000000);
                s.password = { hash: db_hashPassword(plainText, salt), salt: salt };
                upgradedCount++;
            }
        });
    }
    if (stateDatabase.teachers) {
        stateDatabase.teachers.forEach(t => {
            if (t.password && typeof t.password === 'string') {
                const plainText = t.password;
                const salt = "SALT-" + Math.floor(Math.random() * 1000000);
                t.password = { hash: db_hashPassword(plainText, salt), salt: salt };
                upgradedCount++;
            }
        });
    }
    if (upgradedCount > 0) {
        saveState();
        db_logEvent('System', 'System', 'Security Migration', `Upgraded ${upgradedCount} legacy plain-text user passwords to secure hashed storage objects dynamically.`);
    }
}

// Execute legacy upgrade on database load
db_secureExistingPlaintextPasswords();

// Cleanup script to remove the seeded students
(function cleanupSeededStudents() {
    if (stateDatabase.students) {
        const imageStudents = [
            "L R H H N", "A I R P P", "P I G A I", "P I G A B", "C I B A P", 
            "A I R A I", "A M B A F", "P I G A H", "A I G H I", "P I G A S", 
            "C I R A P", "P I G A P", "P I M R A F", "P I B A P", "P I B A B"
        ];
        const originalLength = stateDatabase.students.length;
        stateDatabase.students = stateDatabase.students.filter(s => !imageStudents.includes(s.name));
        if (stateDatabase.students.length !== originalLength) {
            saveState();
        }
    }
})();