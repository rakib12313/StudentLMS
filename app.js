// app.js
import { auth, db, provider } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, addDoc, getDocs, query, orderBy, serverTimestamp, updateDoc, where } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let currentUser = null;
let currentExam = null;
let examTimer = null;

// --- AUTH ---
document.getElementById('google-login-btn')?.addEventListener('click', async () => {
    try {
        const res = await signInWithPopup(auth, provider);
        handleUser(res.user);
    } catch(e) { alert("Login failed: " + e.message); }
});

document.getElementById('logout-btn')?.addEventListener('click', () => {
    signOut(auth).then(() => location.reload());
});

onAuthStateChanged(auth, (user) => {
    if (user) handleUser(user);
    else showLoginScreen();
});

async function handleUser(user) {
    const userRef = doc(db, "students", user.uid);
    const snap = await getDoc(userRef);
    
    if (snap.exists()) {
        currentUser = snap.data();
    } else {
        currentUser = {
            uid: user.uid, name: user.displayName, email: user.email,
            role: "student", approved: false, photo: user.photoURL
        };
        await setDoc(userRef, currentUser);
    }
    initDashboard();
}

function showLoginScreen() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('dashboard-section').classList.add('hidden');
}

function initDashboard() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    // UI Updates
    document.getElementById('nav-photo').src = currentUser.photo;
    document.getElementById('profile-photo').src = currentUser.photo;
    document.getElementById('profile-name').innerText = currentUser.name;
    document.getElementById('profile-email').innerText = currentUser.email;
    document.getElementById('role-badge-nav').innerText = currentUser.role.toUpperCase();

    if (!currentUser.approved) {
        document.getElementById('approval-warning').classList.remove('hidden');
        return; 
    }

    document.getElementById('main-content').classList.remove('hidden');

    // Admin Features
    if (currentUser.role === 'admin') {
        document.getElementById('admin-stats').classList.remove('hidden'); 
        document.getElementById('admin-stats').classList.add('grid');
        document.getElementById('admin-upload-ui').classList.remove('hidden');
        document.getElementById('admin-exam-ui').classList.remove('hidden');
        document.getElementById('tab-users').classList.remove('hidden'); 
        loadAllUsers();
    } else {
        document.getElementById('student-score-card').classList.remove('hidden');
        loadMyResults();
    }

    loadNotes();
    loadExams();
}

window.openProfileModal = () => document.getElementById('profile-modal').classList.remove('hidden');

// --- TABS ---
window.switchTab = (tab) => {
    ['notes', 'exams', 'users'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const view = document.getElementById(`view-${t}`);
        if(btn) {
            if(t === tab) {
                btn.className = "flex-1 py-3 active-tab font-bold";
                view?.classList.remove('hidden');
            } else {
                btn.className = "flex-1 py-3 inactive-tab";
                view?.classList.add('hidden');
            }
        }
    });
};

// --- 1. ADMIN: USER MANAGEMENT ---
async function loadAllUsers() {
    if(currentUser.role !== 'admin') return;
    const snaps = await getDocs(collection(db, "students"));
    const list = document.getElementById('users-list');
    list.innerHTML = "";
    
    let count = 0;
    snaps.forEach(doc => {
        const u = doc.data();
        count++;
        const div = document.createElement('div');
        div.className = "table-row flex justify-between items-center";
        div.innerHTML = `
            <div class="flex items-center gap-3">
                <img src="${u.photo}" class="w-8 h-8 rounded-full">
                <div>
                    <div class="font-bold text-sm text-gray-800">${u.name}</div>
                    <div class="text-xs text-gray-500">${u.email}</div>
                </div>
            </div>
            <div class="flex flex-col items-end gap-1">
                <span class="${u.role==='admin'?'badge-admin':(u.approved?'badge-approved':'badge-pending')}">
                    ${u.role==='admin'?'Admin':(u.approved?'Active':'Pending')}
                </span>
                ${u.role !== 'admin' ? 
                    `<button onclick="toggleUserStatus('${u.uid}', ${u.approved})" class="text-xs text-blue-600 font-bold">
                        ${u.approved ? 'Block' : 'Approve'}
                    </button>` : ''
                }
            </div>
        `;
        list.appendChild(div);
    });
    document.getElementById('stat-users').innerText = count;
}

window.toggleUserStatus = async (uid, currentStatus) => {
    if(!confirm(`Change status?`)) return;
    await updateDoc(doc(db, "students", uid), { approved: !currentStatus });
    loadAllUsers();
};

// --- 2. NOTES SYSTEM (CLOUDINARY) ---
document.getElementById('upload-btn')?.addEventListener('click', async () => {
    const fileInput = document.getElementById('note-file');
    const title = document.getElementById('note-title').value;
    const status = document.getElementById('upload-status');

    // 🔴🔴 MAKE SURE YOU CREATED "lms_upload" PRESET IN CLOUDINARY 🔴🔴
    const CLOUD_NAME = "dpe74ejhl"; 
    const UPLOAD_PRESET = "lms_upload"; 

    if(fileInput.files.length === 0 || !title) return alert("Missing fields");

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('upload_preset', UPLOAD_PRESET);

    status.innerText = "⏳ Uploading to Cloud...";
    
    try {
        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if(data.error) throw new Error(data.error.message);

        let type = 'image';
        if(data.format === 'pdf' || fileInput.files[0].name.endsWith('.pdf')) type = 'pdf';

        await addDoc(collection(db, "notes"), {
            title, url: data.secure_url, type, createdAt: serverTimestamp()
        });
        
        status.innerText = "✅ Uploaded!";
        fileInput.value = ""; document.getElementById('note-title').value = "";
        loadNotes();
    } catch(e) { status.innerText = "Error: " + e.message; }
});

async function loadNotes() {
    const snaps = await getDocs(query(collection(db, "notes"), orderBy("createdAt", "desc")));
    const list = document.getElementById('notes-list');
    list.innerHTML = "";
    snaps.forEach(doc => {
        const n = doc.data();
        const div = document.createElement('div');
        div.className = "bg-white p-3 rounded shadow border-l-4 border-orange-400 flex justify-between items-center";
        div.innerHTML = `
            <div>
                <h4 class="font-bold text-gray-800 text-sm">${n.title}</h4>
                <span class="text-xs text-gray-400 uppercase">${n.type}</span>
            </div>
            <button onclick="openViewer('${n.url}', '${n.type}')" class="bg-blue-50 text-blue-600 px-3 py-1 rounded text-xs font-bold">Open</button>
        `;
        list.appendChild(div);
    });
}

window.openViewer = (url, type) => {
    document.getElementById('viewer-modal').classList.remove('hidden');
    const wm = document.getElementById('watermark-overlay');
    wm.innerHTML = "";
    for(let i=0; i<30; i++) wm.innerHTML += `<div class="watermark-text">${currentUser.email}</div>`;
    
    const pdf = document.getElementById('pdf-frame');
    const img = document.getElementById('image-frame');
    if(type === 'pdf') {
        pdf.src = url; pdf.classList.remove('hidden'); img.classList.add('hidden');
    } else {
        img.src = url; img.classList.remove('hidden'); pdf.classList.add('hidden');
    }
};
window.closeViewer = () => {
    document.getElementById('viewer-modal').classList.add('hidden');
    document.getElementById('pdf-frame').src = "";
};

// --- 3. EXAM SYSTEM ---
window.openExamCreator = () => document.getElementById('exam-creator-modal').classList.remove('hidden');
window.closeExamCreator = () => document.getElementById('exam-creator-modal').classList.add('hidden');

window.addQuestionField = () => {
    const c = document.getElementById('questions-container');
    const div = document.createElement('div');
    div.className = "bg-gray-50 p-3 rounded border q-block relative";
    div.innerHTML = `
        <div class="absolute right-2 top-2 text-xs text-gray-400">Q${c.children.length+1}</div>
        <input class="w-full border p-2 mb-2 rounded font-bold text-sm q-text bg-white" placeholder="Question">
        <div class="grid grid-cols-2 gap-2 mb-2">
            <input class="border p-1 rounded text-xs q-opt1" placeholder="A">
            <input class="border p-1 rounded text-xs q-opt2" placeholder="B">
            <input class="border p-1 rounded text-xs q-opt3" placeholder="C">
            <input class="border p-1 rounded text-xs q-opt4" placeholder="D">
        </div>
        <select class="w-full border p-2 rounded text-sm q-correct bg-white">
            <option value="1">Correct: A</option>
            <option value="2">Correct: B</option>
            <option value="3">Correct: C</option>
            <option value="4">Correct: D</option>
        </select>
    `;
    c.appendChild(div);
};

window.publishExam = async () => {
    const title = document.getElementById('new-exam-title').value;
    const dur = document.getElementById('new-exam-duration').value;
    const qBlocks = document.querySelectorAll('.q-block');
    
    if(!title || !dur || qBlocks.length===0) return alert("Incomplete");
    
    const questions = [];
    qBlocks.forEach(b => {
        questions.push({
            text: b.querySelector('.q-text').value,
            options: [
                b.querySelector('.q-opt1').value, b.querySelector('.q-opt2').value,
                b.querySelector('.q-opt3').value, b.querySelector('.q-opt4').value
            ],
            correct: parseInt(b.querySelector('.q-correct').value) - 1
        });
    });

    await addDoc(collection(db, "exams"), { title, duration: parseInt(dur), questions, createdAt: serverTimestamp() });
    closeExamCreator(); loadExams();
};

async function loadExams() {
    const snaps = await getDocs(query(collection(db, "exams"), orderBy("createdAt", "desc")));
    const list = document.getElementById('exams-list');
    list.innerHTML = "";
    
    const resSnaps = await getDocs(query(collection(db, "results"), where("studentId", "==", currentUser.uid)));
    const takenIds = [];
    resSnaps.forEach(doc => takenIds.push(doc.data().examId));

    if(currentUser.role === 'admin') document.getElementById('stat-exams').innerText = snaps.size;

    snaps.forEach(doc => {
        const e = doc.data();
        const isTaken = takenIds.includes(doc.id);
        const div = document.createElement('div');
        div.className = "bg-white p-4 rounded shadow flex justify-between items-center " + (isTaken ? "border-l-4 border-green-500" : "border-l-4 border-indigo-500");
        div.innerHTML = `
            <div>
                <h3 class="font-bold text-gray-800 text-sm">${e.title}</h3>
                <p class="text-xs text-gray-500">${e.duration}m • ${e.questions.length}Q</p>
            </div>
            ${isTaken 
                ? `<span class="text-xs font-bold text-green-700 bg-green-100 px-2 py-1 rounded">Done</span>`
                : `<button onclick="startExam('${doc.id}')" class="bg-indigo-600 text-white px-3 py-1.5 rounded text-xs font-bold">Start</button>`
            }
        `;
        list.appendChild(div);
    });
}

async function loadMyResults() {
    const q = query(collection(db, "results"), where("studentId", "==", currentUser.uid), orderBy("submittedAt", "desc"));
    const snaps = await getDocs(q);
    const list = document.getElementById('my-results-list');
    list.innerHTML = snaps.empty ? "<p class='text-gray-400 italic'>No exams yet.</p>" : "";
    
    snaps.forEach(doc => {
        const r = doc.data();
        const percent = Math.round((r.score / r.total) * 100);
        const color = percent >= 40 ? 'text-green-600' : 'text-red-600';
        list.innerHTML += `<div class="flex justify-between border-b pb-1 mb-1 last:border-0"><span class="truncate w-32">${r.examTitle}</span><span class="font-bold ${color}">${r.score}/${r.total}</span></div>`;
    });
}

window.startExam = async (eid) => {
    const docSnap = await getDoc(doc(db, "exams", eid));
    currentExam = { id: docSnap.id, ...docSnap.data() };
    
    document.getElementById('exam-taker-modal').classList.remove('hidden');
    document.getElementById('taking-exam-title').innerText = currentExam.title;
    const area = document.getElementById('exam-questions-area');
    area.innerHTML = "";
    
    currentExam.questions.forEach((q, idx) => {
        area.innerHTML += `
            <div class="bg-white p-4 rounded shadow mb-4">
                <p class="font-bold text-sm mb-2">${idx+1}. ${q.text}</p>
                ${q.options.map((opt, i) => `<label class="flex items-center gap-2 border p-2 rounded text-sm mb-2"><input type="radio" name="q-${idx}" value="${i}"> ${opt}</label>`).join('')}
            </div>
        `;
    });

    let time = currentExam.duration * 60;
    const disp = document.getElementById('timer-display');
    examTimer = setInterval(() => {
        time--;
        const m = Math.floor(time/60);
        const s = time%60;
        disp.innerText = `${m}:${s<10?'0'+s:s}`;
        if(time <= 0) submitExam();
    }, 1000);
};

window.submitExam = async () => {
    clearInterval(examTimer);
    let score = 0;
    currentExam.questions.forEach((q, idx) => {
        const sel = document.querySelector(`input[name="q-${idx}"]:checked`);
        if(sel && parseInt(sel.value) === q.correct) score++;
    });

    await addDoc(collection(db, "results"), {
        examId: currentExam.id, examTitle: currentExam.title,
        studentId: currentUser.uid, studentName: currentUser.name,
        score, total: currentExam.questions.length, submittedAt: serverTimestamp()
    });

    document.getElementById('exam-taker-modal').classList.add('hidden');
    alert(`Score: ${score}/${currentExam.questions.length}`);
    loadExams(); loadMyResults();
};