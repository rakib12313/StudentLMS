import { auth, db } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    doc, getDoc, setDoc, collection, getDocs, query, orderBy, serverTimestamp, where, limit, deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// STATE
let isLoginMode = true; // Default to Login
let currentUser = null;
let currentExam = null;
let examTimer = null;
let allNotes = [];

// ELEMENTS
const emailInput = document.getElementById('email');
const passInput = document.getElementById('password');
const mainBtn = document.getElementById('main-action-btn');
const toggleBtn = document.getElementById('toggle-mode-btn');
const statusMsg = document.getElementById('status-msg');

// --- TOGGLE LOGIN / REGISTER ---
if(toggleBtn) {
    toggleBtn.addEventListener('click', () => {
        isLoginMode = !isLoginMode; // Switch Mode
        
        // Update UI based on mode
        if (isLoginMode) {
            document.getElementById('page-title').innerText = "Student Login";
            document.getElementById('page-subtitle').innerText = "Enter your credentials";
            mainBtn.innerText = "Login";
            mainBtn.classList.replace("bg-green-600", "bg-blue-600");
            mainBtn.classList.replace("hover:bg-green-700", "hover:bg-blue-700");
            document.getElementById('toggle-text').innerText = "First time here?";
            toggleBtn.innerText = "Create Account (Setup)";
            statusMsg.innerText = "";
        } else {
            document.getElementById('page-title').innerText = "Account Setup";
            document.getElementById('page-subtitle').innerText = "Verify email & create password";
            mainBtn.innerText = "Create Account";
            mainBtn.classList.replace("bg-blue-600", "bg-green-600");
            mainBtn.classList.replace("hover:bg-blue-700", "hover:bg-green-700");
            document.getElementById('toggle-text').innerText = "Already set up?";
            toggleBtn.innerText = "Back to Login";
            statusMsg.innerText = "";
        }
    });
}

// --- MAIN ACTION (Login or Register) ---
if(mainBtn) {
    mainBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        const pass = passInput.value.trim();

        if(!email || !pass) return showStatus("Please enter email and password", "red");

        mainBtn.disabled = true;
        mainBtn.style.opacity = "0.7";

        try {
            if (isLoginMode) {
                // LOGIN FLOW
                mainBtn.innerText = "Verifying...";
                await signInWithEmailAndPassword(auth, email, pass);
                // Listener handles redirect
            } else {
                // REGISTER FLOW
                mainBtn.innerText = "Checking Admin List...";
                
                // 1. Check if Admin added this email
                const q = query(collection(db, "students"), where("email", "==", email));
                const snap = await getDocs(q);

                if(snap.empty) {
                    throw new Error("This email is not registered by Admin.");
                }

                // 2. Create Auth
                mainBtn.innerText = "Creating...";
                const userCred = await createUserWithEmailAndPassword(auth, email, pass);
                const user = userCred.user;

                // 3. Link Database
                const preDoc = snap.docs[0];
                const data = preDoc.data();
                
                await setDoc(doc(db, "students", user.uid), {
                    ...data,
                    uid: user.uid,
                    email: email,
                    name: data.name || "Student", // Use name set by admin
                    role: data.role || "student",
                    approved: true
                });

                // Cleanup placeholder
                if(preDoc.id !== user.uid) await deleteDoc(doc(db, "students", preDoc.id));

                showStatus("Success! Logging you in...", "green");
            }
        } catch(e) {
            console.error(e);
            let msg = e.message;
            if(msg.includes("auth/invalid-credential")) msg = "Wrong Email or Password.";
            if(msg.includes("auth/email-already-in-use")) msg = "Account already exists. Please Login.";
            if(msg.includes("weak-password")) msg = "Password should be at least 6 chars.";
            
            showStatus(msg, "red");
            mainBtn.disabled = false;
            mainBtn.style.opacity = "1";
            mainBtn.innerText = isLoginMode ? "Login" : "Create Account";
        }
    });
}

function showStatus(msg, color) {
    statusMsg.innerText = msg;
    statusMsg.className = `text-xs text-center mt-4 font-bold h-5 text-${color}-600`;
}

// --- AUTH STATE LISTENER ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Fetch User Data
        try {
            const snap = await getDoc(doc(db, "students", user.uid));
            if(snap.exists()) {
                currentUser = snap.data();
                initDashboard();
            } else {
                // If Auth exists but DB doc missing (Deleted user)
                await signOut(auth);
                showStatus("Account not found.", "red");
                showLoginScreen();
            }
        } catch(e) {
            console.error(e);
        }
    } else {
        showLoginScreen();
    }
});

// --- DASHBOARD FUNCTIONS ---
function showLoginScreen() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('dashboard-section').classList.add('hidden');
    if(mainBtn) {
        mainBtn.disabled = false;
        mainBtn.style.opacity = "1";
        mainBtn.innerText = isLoginMode ? "Login" : "Create Account";
    }
}

function initDashboard() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    document.getElementById('profile-name').innerText = currentUser.name;
    document.getElementById('profile-email').innerText = currentUser.email;
    document.getElementById('profile-initial').innerText = currentUser.name.charAt(0).toUpperCase();

    if (currentUser.role === 'admin') {
        document.getElementById('admin-link-btn').classList.remove('hidden');
    }
    
    loadAnnouncement();
    loadNotes();
    loadExams();
    loadLeaderboard();
}

// ... (Keep existing Student Logic: Notes, Exams, Leaderboard, Global Utils) ...
// Below are the essential Student Functions required for the dashboard to work.

async function loadAnnouncement() {
    const snap = await getDoc(doc(db, "settings", "announcement"));
    if(snap.exists() && snap.data().text) {
        document.getElementById('announcement-area').classList.remove('hidden');
        document.getElementById('announcement-text').innerText = snap.data().text;
    }
}

async function loadNotes() {
    const snaps = await getDocs(query(collection(db, "notes"), orderBy("createdAt", "desc")));
    allNotes = []; snaps.forEach(doc => allNotes.push(doc.data()));
    renderNotes(allNotes);
}

function renderNotes(notes) {
    const list = document.getElementById('notes-list'); list.innerHTML = "";
    if(notes.length === 0) list.innerHTML = "<p class='text-xs text-gray-400 p-4'>No notes found.</p>";
    notes.forEach(n => {
        const icon = n.type === 'pdf' ? 'fa-file-pdf text-red-500' : 'fa-file-image text-blue-500';
        list.innerHTML += `
        <div onclick="openViewer('${n.url}', '${n.type}')" class="bg-white p-3 rounded-xl border border-slate-100 flex items-center gap-3 active:scale-[0.98] transition cursor-pointer shadow-sm">
            <div class="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center"><i class="fas ${icon} text-lg"></i></div>
            <div class="flex-grow overflow-hidden"><h4 class="font-bold text-slate-700 text-xs truncate">${n.title}</h4><span class="text-[10px] text-slate-400 uppercase">${n.type}</span></div>
        </div>`;
    });
}

document.getElementById('global-search').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    renderNotes(allNotes.filter(n => n.title.toLowerCase().includes(term)));
});

async function loadExams() {
    const snaps = await getDocs(query(collection(db, "exams"), orderBy("createdAt", "desc")));
    const resSnaps = await getDocs(query(collection(db, "results"), where("studentId", "==", currentUser.uid)));
    const takenIds = []; resSnaps.forEach(doc => takenIds.push(doc.data().examId));
    
    const list = document.getElementById('exams-list'); list.innerHTML = "";
    if(snaps.empty) list.innerHTML = "<p class='text-xs text-gray-400 p-4'>No exams available.</p>";

    snaps.forEach(doc => {
        const e = doc.data();
        const isTaken = takenIds.includes(doc.id);
        list.innerHTML += `
        <div class="bg-white p-3 rounded-xl border border-slate-100 flex justify-between items-center shadow-sm">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg flex items-center justify-center ${isTaken?'bg-green-100 text-green-600':'bg-indigo-100 text-indigo-600'}"><i class="fas ${isTaken?'fa-check':'fa-pen'}"></i></div>
                <div><h3 class="font-bold text-slate-700 text-xs truncate w-32">${e.title}</h3><p class="text-[10px] text-slate-400">${e.duration}m • ${e.questions.length}Q</p></div>
            </div>
            ${!isTaken ? `<button onclick="startExam('${doc.id}')" class="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm">Start</button>` : `<span class="text-[10px] font-bold text-green-500 bg-green-50 px-2 py-1 rounded">Done</span>`}
        </div>`;
    });
    
    if(takenIds.length > 0) {
        document.getElementById('student-score-card').classList.remove('hidden');
        const resList = document.getElementById('my-results-list'); resList.innerHTML = "";
        resSnaps.forEach(doc => { const r = doc.data(); resList.innerHTML += `<div class="flex justify-between bg-slate-50 p-2 rounded-lg text-xs"><span class="font-bold text-slate-600 truncate w-32">${r.examTitle}</span><span class="font-bold text-green-600">${r.score}/${r.total}</span></div>`; });
    }
}

window.startExam = async (eid) => {
    const docSnap = await getDoc(doc(db, "exams", eid)); currentExam = {id: docSnap.id, ...docSnap.data()};
    document.getElementById('exam-taker-modal').classList.remove('hidden');
    document.getElementById('taking-exam-title').innerText = currentExam.title;
    const area = document.getElementById('exam-questions-area'); area.innerHTML = "";
    currentExam.questions.forEach((q, idx) => {
        area.innerHTML += `<div class="bg-white p-4 rounded-xl shadow-sm mb-4"><p class="font-bold text-sm mb-2 text-slate-800">Q${idx+1}. ${q.text}</p><div class="space-y-2">${q.options.map((opt, i) => `<label class="flex items-center gap-2 bg-slate-50 p-3 rounded-lg cursor-pointer hover:bg-slate-100"><input type="radio" name="q-${idx}" value="${i}"> <span class="text-xs text-slate-600">${opt}</span></label>`).join('')}</div></div>`;
    });
    let time = currentExam.duration * 60; const disp = document.getElementById('timer-display');
    examTimer = setInterval(() => { time--; const m = Math.floor(time/60); const s = time%60; disp.innerText = `${m}:${s<10?'0'+s:s}`; if(time <= 0) submitExam(); }, 1000);
};

window.submitExam = async () => {
    clearInterval(examTimer); let score=0; currentExam.questions.forEach((q, idx) => { const sel = document.querySelector(`input[name="q-${idx}"]:checked`); if(sel && parseInt(sel.value)===q.correct) score++; });
    await addDoc(collection(db, "results"), { examId: currentExam.id, examTitle: currentExam.title, studentId: currentUser.uid, studentName: currentUser.name, score, total: currentExam.questions.length, submittedAt: serverTimestamp() });
    document.getElementById('exam-taker-modal').classList.add('hidden'); alert(`Score: ${score}`); loadExams(); loadLeaderboard();
};

async function loadLeaderboard() {
    const list = document.getElementById('leaderboard-list'); list.innerHTML = "";
    const snaps = await getDocs(query(collection(db, "results"), orderBy("score", "desc"), limit(10)));
    let rank=1; snaps.forEach(doc => { const r = doc.data(); list.innerHTML += `<div class="p-3 flex justify-between items-center"><div class="flex items-center gap-3"><span class="font-bold text-slate-300 text-lg w-6 text-center">${rank++}</span><div><div class="font-bold text-xs text-slate-700">${r.studentName}</div><div class="text-[10px] text-slate-400 truncate w-32">${r.examTitle}</div></div></div><span class="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded">${r.score}/${r.total}</span></div>`; });
}

window.switchTab = (tab) => {
    ['notes', 'exams', 'leaderboard'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`); const view = document.getElementById(`view-${t}`);
        view.classList.toggle('hidden', t!==tab);
        btn.className = t===tab ? "flex-1 py-2.5 text-xs font-bold rounded-lg bg-white shadow text-blue-600 transition" : "flex-1 py-2.5 text-xs font-medium rounded-lg text-gray-400 hover:bg-gray-50 transition";
    });
};

window.openViewer = (url, type) => {
    document.getElementById('viewer-modal').classList.remove('hidden');
    const wm = document.getElementById('watermark-overlay'); wm.innerHTML = ""; 
    for(let i=0;i<30;i++) wm.innerHTML += `<div class="watermark-text">${currentUser.email}</div>`;
    const pdf = document.getElementById('pdf-frame'); const img = document.getElementById('image-frame');
    if(type === 'pdf') { pdf.src = url; pdf.classList.remove('hidden'); img.classList.add('hidden'); } else { img.src = url; img.classList.remove('hidden'); pdf.classList.add('hidden'); }
};
window.closeViewer = () => { document.getElementById('viewer-modal').classList.add('hidden'); document.getElementById('pdf-frame').src = ""; };
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth).then(() => location.reload()));
