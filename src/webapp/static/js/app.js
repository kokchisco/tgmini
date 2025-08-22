// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Global variables
let userId = null;
let telegramUser = null;
let userData = null;
let currentPage = 'home';

// Get user data from Telegram Web App API
if (window.Telegram && window.Telegram.WebApp) {
    try {
        console.log('Telegram Web App detected');
        window.Telegram.WebApp.ready();
        telegramUser = window.Telegram.WebApp.initDataUnsafe?.user;
        console.log('Telegram user:', telegramUser);
        if (telegramUser) {
            userId = telegramUser.id;
            console.log('User ID from Telegram:', userId);
        }
    } catch (error) {
        console.error('Telegram Web App API error:', error);
    }
}

// Fallback to URL parameters if Telegram API not available
if (!userId) {
    const urlParams = new URLSearchParams(window.location.search);
    userId = urlParams.get('user_id');
}

if (!userId) {
    document.body.innerHTML = '<div class="app-container"><div class="error">User ID not found. Please open this app from Telegram.</div></div>';
}

// API base URL
const API_BASE = window.location.origin;

// Utility functions
const showError = (message) => {
    return `<div class="error">${message}</div>`;
};

const showSuccess = (message) => {
    return `<div class="success">${message}</div>`;
};

const formatNumber = (num) => {
    return num.toLocaleString();
};

const getRankClass = (rank) => {
    if (rank === 1) return 'gold';
    if (rank === 2) return 'silver';
    if (rank === 3) return 'bronze';
    return 'other';
};

// API functions
const apiCall = async (endpoint, options = {}) => {
    try {
        const url = `${API_BASE}${endpoint}`;
        console.log('Making API call to:', url);
        
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });

        console.log('Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Response error:', errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('API response data:', data);
        return data;
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
};

// Router
const router = {
    routes: {
        '/': 'home',
        '/home': 'home',
        '/tasks': 'tasks',
        '/earn': 'earn',
        '/history': 'history',
        '/profile': 'profile',
        '/withdraw': 'withdraw',
        '/bank': 'bank',
        '/advertise': 'advertise',
        '/about': 'about',
        '/faq': 'faq',
        '/invite': 'invite',
        '/team': 'team',
        '/privacy': 'privacy',
        '/community': 'community',
        '/support': 'support'
    },

    init() {
        // Handle browser back/forward
        window.addEventListener('popstate', () => {
            this.navigate(window.location.pathname, false);
        });

        // Handle initial route
        this.navigate(window.location.pathname, false);
    },

    navigate(path, updateHistory = true) {
        const page = this.routes[path] || 'home';
        currentPage = page;
        
        if (updateHistory) {
            window.history.pushState({}, '', path);
        }

        this.loadPage(page);
        this.updateNavigation();
    },

    loadPage(page) {
        const mainContent = document.getElementById('main-content');
        
        switch (page) {
            case 'home':
                this.loadHomePage();
                break;
            case 'tasks':
                this.loadTasksPage();
                break;
            case 'earn':
                this.loadEarnPage();
                break;
            case 'history':
                this.loadHistoryPage();
                break;
            case 'profile':
                this.loadProfilePage();
                break;
            case 'community':
                this.loadCommunityPage();
                break;
            case 'withdraw':
                this.loadWithdrawPage();
                break;
            case 'bank':
                this.loadBankPage();
                break;
            case 'advertise':
                this.loadAdvertisePage();
                break;
            case 'about':
                this.loadAboutPage();
                break;
            case 'faq':
                this.loadFaqPage();
                break;
            case 'invite':
                this.loadInvitePage();
                break;
            case 'team':
                this.loadTeamPage();
                break;
            case 'privacy':
                this.loadPrivacyPage();
                break;
            case 'support':
                this.loadSupportPage();
                break;
            default:
                this.loadHomePage();
        }
    },

    updateNavigation() {
        // Update footer navigation
        document.querySelectorAll('.footer-nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const activeNav = document.querySelector(`[data-page="${currentPage}"]`);
        if (activeNav) {
            activeNav.classList.add('active');
        }
    }
};

// Page loaders
const pageLoaders = {
    async loadHomePage() {
        const mainContent = document.getElementById('main-content');
        mainContent.innerHTML = `
            <div class="loading">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Loading home page...</p>
            </div>
        `;

        try {
            await loadUserData();
            // Show mandatory join modal if configured (block UI underneath)
            await maybeShowOnboardingModal();
            // Load currency/rate for conversion rate display
            let currencySymbol = '₦';
            let pointRate = 1;
            try {
                const cfg = await fetch('/api/admin/config').then(r=>r.json());
                currencySymbol = (cfg && cfg.withdrawalConfig && cfg.withdrawalConfig.currencySymbol) || currencySymbol;
                pointRate = (cfg && cfg.withdrawalConfig && parseFloat(cfg.withdrawalConfig.pointToCurrencyRate)) || pointRate;
            } catch (_) {}
            
            const html = `
                <div class="balance-card">
                    <div class="balance-title">Your Balance</div>
                    <div class="balance-amount" id="balanceAmount">${formatNumber(userData?.points || 0)}</div>
                    <div class="balance-subtitle">
                        <span id="totalFriends">${userData?.friends_invited || 0}</span> friends invited • 
                        Rank <span id="userRank">#${userData?.stats?.rank || 'N/A'}</span>
                    </div>
                    <div style="margin-top:6px;font-size:12px;opacity:0.9;">Conversion rate: 1 point = ${currencySymbol}${(pointRate || 1)}</div>
                </div>

                <div class="card">
                    <h3 style="margin-bottom: 16px; font-size: 18px; font-weight: 600;">Quick Actions</h3>
                                         <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
                         <a href="/withdraw" class="btn btn-primary" style="text-align: center; padding: 16px 8px;">
                             <span class="iconify" data-icon="mdi:bank-transfer"></span>
                             <div style="font-size: 12px; margin-top: 4px;">Withdraw</div>
                         </a>
                         <a href="/advertise" class="btn btn-secondary" style="text-align: center; padding: 16px 8px;">
                             <span class="iconify" data-icon="mdi:bullhorn-outline"></span>
                             <div style="font-size: 12px; margin-top: 4px;">Advertise</div>
                         </a>
                         <a href="/bank" class="btn btn-secondary" style="text-align: center; padding: 16px 8px;">
                             <span class="iconify" data-icon="mdi:bank-outline"></span>
                             <div style="font-size: 12px; margin-top: 4px;">Bank</div>
                         </a>
                     </div>
                </div>

                <div class="card">
                    <h3 style="margin-bottom: 16px; font-size: 18px; font-weight: 600;">Leaderboard</h3>
                    <div id="leaderboardContent">
                        <div class="loading">
                            <i class="fas fa-spinner fa-spin"></i>
                            <p>Loading leaderboard...</p>
                        </div>
                    </div>
                </div>
            `;
            
            mainContent.innerHTML = html;
            await loadLeaderboard();
        } catch (error) {
            mainContent.innerHTML = showError('Failed to load home page');
        }
    },

    async loadTasksPage() {
        const mainContent = document.getElementById('main-content');
        mainContent.innerHTML = `
            <div class="page-title">Tasks</div>
            
            <div class="tabs">
                <div class="tab active" data-task-tab="telegram">Telegram</div>
                <div class="tab" data-task-tab="whatsapp">WhatsApp</div>
                <div class="tab" data-task-tab="facebook">Facebook</div>
                <div class="tab" data-task-tab="tiktok">TikTok</div>
                <div class="tab" data-task-tab="website">Website</div>
            </div>

            <div id="tasksContent">
                <div class="loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Loading tasks...</p>
                </div>
            </div>
        `;

        // Add tab event listeners
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const platform = tab.dataset.taskTab;
                
                // Update active tab
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                // Load tasks for platform
                loadTasks(platform);
            });
        });

        await loadTasks('telegram');
    },

    async loadEarnPage() {
        const mainContent = document.getElementById('main-content');
        mainContent.innerHTML = `
            <div class="page-title">Daily Rewards</div>
            
            <div class="balance-card">
                <div class="balance-title">Claims Remaining</div>
                <div class="balance-amount" id="earnProgress">0/5</div>
                <div class="balance-subtitle">Claim your daily rewards</div>
            </div>

            <div class="card">
                <button id="claimBtn" class="btn btn-primary" style="width: 100%; margin-bottom: 16px;">
                    <span class="iconify" data-icon="mdi:gift-outline"></span>
                    <span>Claim Reward</span>
                    <div class="spinner" id="claimSpinner"></div>
                </button>
                <div style="text-align: center; font-size: 14px; color: #6c757d;">
                    Click claim to receive random rewards
                </div>
            </div>

            <div class="card">
                <h3 style="margin-bottom: 16px; font-size: 18px; font-weight: 600;">Claim History</h3>
                <div id="earnHistory">
                    <div class="loading">
                        <i class="fas fa-spinner fa-spin"></i>
                        <p>Loading history...</p>
                    </div>
                </div>
            </div>
        `;

        // Bind click handler (avoid inline to pass CSP)
        try {
            const btn = document.getElementById('claimBtn');
            if (btn) btn.addEventListener('click', claimReward);
        } catch (e) { console.error('Failed to bind claim button', e); }

        await enforceCommunityOrRedirect('earn');
        await loadEarnData();
    },

    async loadHistoryPage() {
        const mainContent = document.getElementById('main-content');
        mainContent.innerHTML = `
            <div class="page-title">History</div>
            
            <div class="tabs">
                <div class="tab active" data-history-tab="withdrawals">Withdrawals</div>
                <div class="tab" data-history-tab="earnings">Earnings</div>
            </div>

            <div id="historyContent">
                <div class="loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Loading history...</p>
                </div>
            </div>
        `;

        // Add tab event listeners
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const type = tab.dataset.historyTab;
                
                // Update active tab
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                // Load history for type
                loadHistory(type);
            });
        });

        await loadHistory('withdrawals');
    },

    async loadProfilePage() {
        const mainContent = document.getElementById('main-content');
        mainContent.innerHTML = `
            <div class="page-title">Profile</div>
            
            <div class="balance-card">
                <div class="balance-title">Your Balance</div>
                <div class="balance-amount" id="profileBalanceAmount">${formatNumber(userData?.points || 0)}</div>
            </div>

            <div class="card">
                <a href="/community" class="menu-item">
                    <div class="menu-item-left">
                        <div class="menu-item-icon">
                            <span class="iconify" data-icon="mdi:account-group"></span>
                        </div>
                        <div class="menu-item-text">Community</div>
                    </div>
                    <div class="menu-item-arrow">
                        <span class="iconify" data-icon="mdi:chevron-right"></span>
                    </div>
                </a>

                <a href="/invite" class="menu-item">
                    <div class="menu-item-left">
                        <div class="menu-item-icon">
                            <span class="iconify" data-icon="mdi:account-plus-outline"></span>
                        </div>
                        <div class="menu-item-text">Invite Friends</div>
                    </div>
                    <div class="menu-item-arrow">
                        <span class="iconify" data-icon="mdi:chevron-right"></span>
                    </div>
                </a>
                
                <a href="/team" class="menu-item">
                    <div class="menu-item-left">
                        <div class="menu-item-icon">
                            <span class="iconify" data-icon="mdi:account-group-outline"></span>
                        </div>
                        <div class="menu-item-text">My Team</div>
                    </div>
                    <div class="menu-item-arrow">
                        <span class="iconify" data-icon="mdi:chevron-right"></span>
                    </div>
                </a>
                
                <a href="/about" class="menu-item">
                    <div class="menu-item-left">
                        <div class="menu-item-icon">
                            <span class="iconify" data-icon="mdi:information-outline"></span>
                        </div>
                        <div class="menu-item-text">About Us</div>
                    </div>
                    <div class="menu-item-arrow">
                        <span class="iconify" data-icon="mdi:chevron-right"></span>
                    </div>
                </a>
                
                <a href="/support" class="menu-item">
                    <div class="menu-item-left">
                        <div class="menu-item-icon">
                            <span class="iconify" data-icon="mdi:headset"></span>
                        </div>
                        <div class="menu-item-text">Support</div>
                    </div>
                    <div class="menu-item-arrow">
                        <span class="iconify" data-icon="mdi:chevron-right"></span>
                    </div>
                </a>
                
                <a href="/faq" class="menu-item">
                    <div class="menu-item-left">
                        <div class="menu-item-icon">
                            <span class="iconify" data-icon="mdi:help-circle-outline"></span>
                        </div>
                        <div class="menu-item-text">FAQs</div>
                    </div>
                    <div class="menu-item-arrow">
                        <span class="iconify" data-icon="mdi:chevron-right"></span>
                    </div>
                </a>
                <a href="/privacy" class="menu-item">
                    <div class="menu-item-left">
                        <div class="menu-item-icon">
                            <span class="iconify" data-icon="mdi:shield-account-outline"></span>
                        </div>
                        <div class="menu-item-text">Privacy & Policy</div>
                    </div>
                    <div class="menu-item-arrow">
                        <span class="iconify" data-icon="mdi:chevron-right"></span>
                    </div>
                </a>
            </div>
        `;
    },

    async loadWithdrawPage() {
        const mainContent = document.getElementById('main-content');
        // Ensure fresh user data for accurate balance
        try { await loadUserData(); } catch (e) {}
        const cfg = await fetch('/api/admin/config').then(r=>r.json()).catch(()=>({ withdrawalConfig: { currencySymbol: '₦', pointToCurrencyRate: 1, minWithdrawal: 1000, withdrawalsEnabled: true } }));
        const curr = (cfg && cfg.withdrawalConfig && cfg.withdrawalConfig.currencySymbol) || '₦';
        const rate = (cfg && cfg.withdrawalConfig && parseFloat(cfg.withdrawalConfig.pointToCurrencyRate)) || 1;
        const minWithdrawalPoints = (cfg && cfg.withdrawalConfig && parseInt(cfg.withdrawalConfig.minWithdrawal)) || 1000;
        // Make available to form validator
        window.__minWithdrawalPoints = minWithdrawalPoints;
        mainContent.innerHTML = `
            <div class="page-title">Withdraw</div>
            
            <div class="balance-card">
                <div class="balance-title">Available Points</div>
                <div class="balance-amount" id="withdrawBalance">${formatNumber(userData?.points || 0)}</div>
            </div>

            <div class="card">
                <form id="withdrawForm">
                    <div class="form-group">
                        <label class="form-label">Amount to Withdraw</label>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <input type="number" class="form-input" id="withdrawAmount" placeholder="Enter amount" min="1000" step="100" style="flex:1;">
                            <div style="white-space:nowrap; font-size:13px; opacity:0.9;">= <span id="withdrawConverted">${curr}0.00</span></div>
                        </div>
                        <div style="margin-top:6px;font-size:12px;opacity:0.85;">Amount to be received</div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Bank Account</label>
                        <input type="text" class="form-input" id="bankAccount" placeholder="Bank account details" readonly>
                    </div>
                                         <button type="submit" class="btn btn-primary" style="width: 100%;">
                         <span class="iconify" data-icon="mdi:send-outline"></span> Apply Withdrawal
                     </button>
                </form>
                <div style="margin-top: 16px; text-align: center; font-size: 14px; color: #6c757d;">
                    Minimum withdrawal: ${formatNumber(minWithdrawalPoints)} points<br>
                    Processing time: 24-48 hours
                </div>
            </div>
        `;

        await enforceCommunityOrRedirect('withdraw');
        await loadWithdrawData();
        setupWithdrawForm();
        // Disable form if withdrawals are disabled by admin
        const enabled = cfg && cfg.withdrawalConfig && cfg.withdrawalConfig.withdrawalsEnabled !== false;
        if (!enabled) {
            const form = document.getElementById('withdrawForm');
            const btn = document.querySelector('#withdrawForm button[type="submit"]');
            if (form) Array.from(form.elements).forEach(el => el.disabled = true);
            if (btn) btn.textContent = 'Withdrawals are closed';
        }
        const amt = document.getElementById('withdrawAmount');
        const conv = document.getElementById('withdrawConverted');
        const toMoney = (points) => {
            const val = (parseFloat(points || 0) * rate);
            if (!isFinite(val)) return `${curr}0.00`;
            return `${curr}${val.toFixed(2)}`;
        };
        if (amt && conv) {
            const upd = () => { conv.textContent = toMoney(amt.value); };
            amt.addEventListener('input', upd);
            upd();
        }
    },

    async loadBankPage() {
        const mainContent = document.getElementById('main-content');
        mainContent.innerHTML = `
            <div class="page-title">Bank Setup</div>
            
            <div class="balance-card">
                <div class="balance-title">Bank Account Setup</div>
                <div class="balance-subtitle">Add your bank details to receive withdrawals</div>
            </div>

            <div class="card">
                <form id="bankForm">
                    <div class="form-group">
                        <label class="form-label">Account Name</label>
                        <input type="text" class="form-input" id="accountName" placeholder="Enter account name">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Account Number</label>
                        <input type="text" class="form-input" id="accountNumber" placeholder="Enter account number">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Bank</label>
                        <select class="form-select" id="bankSelect">
                            <option value="">Select your bank</option>
                            <option value="kuda">Kuda Bank</option>
                            <option value="moniepoint">Moniepoint</option>
                            <option value="opay">Opay</option>
                            <option value="palmpay">PalmPay</option>
                            <option value="smartcash">SmartCash</option>
                        </select>
                    </div>
                                         <button type="submit" class="btn btn-primary" style="width: 100%;">
                         <i class="fas fa-save">💾</i> Save Bank Details
                     </button>
                </form>
                <div style="margin-top: 16px; text-align: center; font-size: 14px; color: #6c757d;">
                    Bank details can only be added once.<br>
                    To modify: 3,000 points fee
                </div>
            </div>
        `;

        await loadBankData();
        setupBankForm();
    },

    async loadAdvertisePage() {
        const mainContent = document.getElementById('main-content');
        mainContent.innerHTML = `
            <div class="page-title">Advertise</div>
            
            <div class="empty-state">
                <span class="iconify" data-icon="mdi:bullhorn-outline"></span>
                <h3>Coming Soon!</h3>
                <p>Advertise your channels and groups to get more members!</p>
            </div>

            <div class="card" id="advertiseHelp">
                <div style="margin-bottom:8px; font-weight:600;">Want us to upload your link?</div>
                <div style="opacity:0.85; margin-bottom:12px;">Open Support to submit your channel/group for promotion.</div>
                <a href="/support" class="btn btn-primary" style="width:100%">
                    <span class="iconify" data-icon="mdi:headset"></span> Open Support
                </a>
            </div>
        `;
    },

    async loadCommunityPage() {
        const mainContent = document.getElementById('main-content');
        mainContent.innerHTML = `
            <div class="page-title">Community</div>
            <div class="card" id="communityCard">
                <div class="loading">Loading…</div>
            </div>
        `;
        try {
            const cfg = await fetch('/api/onboarding-config').then(r => r.json());
            const chan = cfg.requiredChannel ? `https://t.me/${String(cfg.requiredChannel).replace(/^@/, '')}` : null;
            const grp = cfg.requiredGroup ? `https://t.me/${String(cfg.requiredGroup).replace(/^@/, '')}` : null;
            const html = `
                <div style="display:flex;flex-direction:column;gap:12px;">
                    <div>${cfg.onboardingWelcome || 'Join our official community and sponsor group to continue.'}</div>
                    ${chan ? `<a class="btn btn-secondary" href="${chan}" target="_blank">Join Official Channel</a>` : ''}
                    ${grp ? `<a class="btn btn-secondary" href="${grp}" target="_blank">Join Sponsor Group</a>` : ''}
                    <button id="communityCheck" class="btn btn-primary">I have joined, Check now</button>
                    <div id="communityStatus" style="font-size:12px;opacity:0.9;"></div>
                </div>
            `;
            document.getElementById('communityCard').innerHTML = html;
            document.getElementById('communityCheck').addEventListener('click', async () => {
                const resp = await fetch('/api/verify-onboarding-joins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telegramId: userId }) });
                const r = await resp.json();
                const s = document.getElementById('communityStatus');
                if (r.ok) { s.textContent = '✅ Verified. You can continue.'; s.style.color = '#4ecdc4'; }
                else { s.textContent = '❌ You must join both the channel and the sponsor group.'; s.style.color = '#ff6b6b'; }
            });
        } catch (_) {
            document.getElementById('communityCard').innerHTML = '<div class="error">Failed to load</div>';
        }
    },

    async loadSupportPage() {
        const mainContent = document.getElementById('main-content');
        mainContent.innerHTML = `
            <div class="page-title">Support</div>
            <div class="card" id="supportList">
                <div class="loading"><i class="fas fa-spinner fa-spin"></i><p>Loading support contacts...</p></div>
            </div>
        `;
        try {
            const cfg = await fetch('/api/admin/config').then(r=>r.json());
            const admins = (cfg && cfg.supportConfig && Array.isArray(cfg.supportConfig.supportAdmins)) ? cfg.supportConfig.supportAdmins : [];
            const items = admins.filter(a => a && a.username).map(a => {
                const uname = String(a.username).replace(/^@/, '');
                const desc = a.description || '';
                const url = `https://t.me/${uname}`;
                return `
                    <div class="history-item">
                        <div class="history-header">
                            <div class="history-title">@${uname}</div>
                            <a href="${url}" target="_blank" class="btn btn-primary"><span class="iconify" data-icon="mdi:send"></span> Open Chat</a>
                        </div>
                        <div class="history-date">${desc}</div>
                    </div>
                `;
            });
            document.getElementById('supportList').innerHTML = items.length ? items.join('') : '<div class="empty-state"><span class="iconify" data-icon="mdi:headset"></span><h3>No support admins configured</h3><p>Please check back later.</p></div>';
        } catch (e) {
            document.getElementById('supportList').innerHTML = '<div class="error">Failed to load support contacts.</div>';
        }
    },

         async loadAboutPage() {
         const mainContent = document.getElementById('main-content');
         mainContent.innerHTML = `
             <div class="page-title">About TGTask</div>
             
             <div class="balance-card">
                 <div class="balance-title">About TGTask</div>
                 <div class="balance-subtitle">
                     TGTask is a platform that rewards users for completing tasks across Telegram and other socials.
                 </div>
             </div>
 
             <div class="card">
                 <div class="menu-item">
                     <div class="menu-item-left">
                         <div class="menu-item-icon">
                             <span class="iconify" data-icon="mdi:account-group-outline"></span>
                         </div>
                         <div class="menu-item-text">Active Users</div>
                     </div>
                     <div class="menu-item-arrow">10,000+</div>
                 </div>
                 <div class="menu-item">
                     <div class="menu-item-left">
                         <div class="menu-item-icon">
                             <span class="iconify" data-icon="mdi:cash"></span>
                         </div>
                         <div class="menu-item-text">Total Paid</div>
                     </div>
                     <div class="menu-item-arrow">₦5M+</div>
                 </div>
                 <div class="menu-item">
                     <div class="menu-item-left">
                         <div class="menu-item-icon">
                             <span class="iconify" data-icon="mdi:star-outline"></span>
                         </div>
                         <div class="menu-item-text">Rating</div>
                     </div>
                     <div class="menu-item-arrow">4.8/5</div>
                 </div>
             </div>
         `;
     },

         async loadFaqPage() {
         const mainContent = document.getElementById('main-content');
         mainContent.innerHTML = `
             <div class="page-title">FAQs</div>
             
             <div class="card">
                 <div class="faq-item">
                     <div class="menu-item" data-faq-id="faq1">
                         <div class="menu-item-left">
                             <div class="menu-item-icon">
                                 <span class="iconify" data-icon="mdi:help-circle-outline"></span>
                             </div>
                             <div class="menu-item-text">How do I earn points?</div>
                         </div>
                         <div class="menu-item-arrow">
                             <span class="iconify" id="faq1-arrow" data-icon="mdi:chevron-down"></span>
                         </div>
                     </div>
                     <div class="faq-content" id="faq1-content">
                         <strong>Earn points by:</strong><br><br>
                         - Join channels/groups<br>
                         - Invite friends<br>
                         - Claim daily rewards
                     </div>
                 </div>
                 
                 <div class="faq-item">
                     <div class="menu-item" data-faq-id="faq2">
                         <div class="menu-item-left">
                             <div class="menu-item-icon">
                                 <span class="iconify" data-icon="mdi:cash"></span>
                             </div>
                             <div class="menu-item-text">When can I withdraw?</div>
                         </div>
                         <div class="menu-item-arrow">
                             <span class="iconify" id="faq2-arrow" data-icon="mdi:chevron-down"></span>
                         </div>
                     </div>
                     <div class="faq-content" id="faq2-content">
                         Minimum balance, processing time, and bank details apply.
                     </div>
                 </div>
                 
                 <div class="faq-item">
                     <div class="menu-item" data-faq-id="faq3">
                         <div class="menu-item-left">
                             <div class="menu-item-icon">
                                 <span class="iconify" data-icon="mdi:account-plus-outline"></span>
                             </div>
                             <div class="menu-item-text">How do referrals work?</div>
                         </div>
                         <div class="menu-item-arrow">
                             <span class="iconify" id="faq3-arrow" data-icon="mdi:chevron-down"></span>
                         </div>
                     </div>
                     <div class="faq-content" id="faq3-content">
                         Share your link; earn when friends join.
                     </div>
                 </div>
             </div>
         `;
         
         try {
             const items = mainContent.querySelectorAll('.faq-item .menu-item[data-faq-id]');
             items.forEach(item => {
                 const faqId = item.getAttribute('data-faq-id');
                 item.addEventListener('click', () => toggleFaq(faqId));
             });
         } catch(e) { console.error('Error binding FAQ handlers', e); }
 
     },

     async loadPrivacyPage() {
         const mainContent = document.getElementById('main-content');
         mainContent.innerHTML = `
             <div class="page-title">Privacy & Policy</div>
             <div class="card">
                 <div style="line-height:1.6; color:#333; font-size:14px;">
                     <h3>Usage Rules</h3>
                     <p>- Complete tasks honestly. Misbehavior, spamming, or incomplete tasks may lead to suspension.</p>
                     <p>- No self-referrals or multi-account farming. Accounts detected sharing the same IP across 5+ users may be suspended.</p>
                     <p>- Admins can ban/unban accounts that violate rules.</p>
                     <h3>Withdrawals</h3>
                     <p>- Users can submit only ONE withdrawal request per day.</p>
                     <p>- Ensure accurate bank details. Incorrect details may delay or void payouts.</p>
                     <h3>Data</h3>
                     <p>- We store minimal data to operate the bot (Telegram ID, username, points, tasks, bank info for withdrawals).</p>
                     <p>- We do not sell your data. Contact admin for account deletion.</p>
                 </div>
             </div>
         `;
     },

         async loadInvitePage() {
         const mainContent = document.getElementById('main-content');
         mainContent.innerHTML = `
             <div class="page-title">Invite Friends</div>
             
             <div class="balance-card">
                 <div class="balance-title">Invite Friends</div>
                 <div class="balance-subtitle">Share your referral link and earn points for each friend who joins!</div>
             </div>
 
             <div class="card">
                 <div class="form-group">
                     <label class="form-label">Your Referral Link</label>
                     <div style="display: flex; gap: 8px; align-items: center;">
                         <input type="text" class="form-input" id="referralLinkInput" readonly style="flex: 1;">
                         <button class="btn btn-primary" id="copyButton" style="min-width: auto; padding: 12px; width: 44px; height: 44px; border-radius: 8px;">
                             <span class="iconify" data-icon="mdi:content-copy"></span>
                         </button>
                     </div>
                 </div>
                 
                 <div class="menu-item">
                     <div class="menu-item-left">
                         <div class="menu-item-icon"><span class="iconify" data-icon="mdi:account-group-outline"></span></div>
                         <div class="menu-item-text">Total Referred</div>
                     </div>
                     <div class="menu-item-arrow" id="totalReferred">0</div>
                 </div>
                 <div class="menu-item">
                     <div class="menu-item-left">
                         <div class="menu-item-icon"><span class="iconify" data-icon="mdi:cash"></span></div>
                         <div class="menu-item-text">Referral Earnings</div>
                     </div>
                     <div class="menu-item-arrow" id="referralEarnings">₦0</div>
                 </div>
             </div>
         `;
 
         await loadInviteData();
     },

    async loadTeamPage() {
        const mainContent = document.getElementById('main-content');
        mainContent.innerHTML = `
            <div class="page-title">My Team</div>
            
            <div class="balance-card">
                <div class="balance-title">My Team</div>
                <div class="balance-subtitle">People you've referred to TGTask</div>
            </div>

            <div class="card">
                <div id="teamContent">
                    <div class="loading">
                        <i class="fas fa-spinner fa-spin"></i>
                        <p>Loading team members...</p>
                    </div>
                </div>
            </div>
        `;

        await loadTeamData();
    }
};

// Assign page loaders to router
Object.assign(router, pageLoaders);

// Data loading functions
async function loadUserData() {
    try {
        console.log('Loading user data for ID:', userId);
        const data = await apiCall(`/api/user/${userId}`);
        console.log('User data received:', data);
        userData = data;
        await renderHeader();
    } catch (error) {
        console.error('Error loading user data:', error);
        throw error;
    }
}

async function renderHeader() {
    const header = document.getElementById('header');
    const { first_name, last_name, username } = userData;
    const fullName = `${first_name || ''} ${last_name || ''}`.trim() || 'User';
    const displayName = fullName.length > 20 ? fullName.substring(0, 20) + '...' : fullName;
    
    // Try to get photo from Telegram Web App
    let photoUrl = null;
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe?.user) {
        photoUrl = window.Telegram.WebApp.initDataUnsafe.user.photo_url;
        console.log('Telegram user data:', window.Telegram.WebApp.initDataUnsafe.user);
        console.log('Photo URL:', photoUrl);
    }
    
    const profilePic = photoUrl ? 
        `<img src="${photoUrl}" alt="Profile">` : 
        `<span>${displayName.charAt(0).toUpperCase()}</span>`;
    
    console.log('Rendering header with:', { displayName, username, photoUrl });
    
    // App name (loaded async below)
    header.innerHTML = `
        <div class="header">
            <div class="header-left">
                <div class="profile-pic">
                    ${profilePic}
                </div>
                <div class="user-info">
                    <h3>${displayName}</h3>
                    <p>${username ? `@${username}` : ''}</p>
                </div>
            </div>
            <div class="logo" id="appLogo">TGTask</div>
        </div>
    `;
    // Replace logo with configured app name
    try {
        const cfg = await fetch('/api/admin/config').then(r=>r.json());
        const appName = (cfg && cfg.appConfig && cfg.appConfig.appName) || 'TGTask';
        const el = document.getElementById('appLogo');
        if (el) el.textContent = appName;
        window.__appCfgName = appName;
    } catch(_) {}
}

async function enforceCommunityOrRedirect(context) {
    try {
        const cfg = await fetch('/api/onboarding-config').then(r => r.json());
        if (!cfg.requiredChannelId && !cfg.requiredGroupId) return true;
        const resp = await fetch('/api/verify-onboarding-joins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telegramId: userId }) });
        const r = await resp.json();
        if (r && r.ok) return true;
        alert('You must join the Community before you can continue.');
        window.router.loadCommunityPage();
        return false;
    } catch (_) { return true; }
}

async function maybeShowOnboardingModal() {
    try {
        const onbResp = await fetch('/api/onboarding-config');
        if (!onbResp.ok) return;
        const onb = await onbResp.json();
        if ((!onb.requiredChannel && !onb.requiredGroup)) return;

        // Already joined? don't show
        try {
            const jr = await fetch('/api/verify-onboarding-joins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telegramId: userId }) }).then(r=>r.json());
            if (jr && jr.ok) return;
        } catch (_) {}

        // Once per day
        const todayKey = new Date().toISOString().slice(0,10);
        const seenKey = `onbSeen:${userId}:${todayKey}`;
        if (localStorage.getItem(seenKey)) return;

        if (document.getElementById('onboardingModal')) return;
        const modal = document.createElement('div');
        modal.id = 'onboardingModal';
        Object.assign(modal.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.55)', zIndex: 9999, display:'flex',alignItems:'center',justifyContent:'center',padding:'16px' });
        const card = document.createElement('div');
        Object.assign(card.style, { width:'100%', maxWidth:'460px', background:'#16181a', color:'#fff', borderRadius:'16px', padding:'20px', boxShadow:'0 12px 32px rgba(0,0,0,0.5)' });
        const chUser = onb.requiredChannel ? String(onb.requiredChannel).replace(/^@/, '') : null;
        const grUser = onb.requiredGroup ? String(onb.requiredGroup).replace(/^@/, '') : null;
        card.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><span class="iconify" data-icon="mdi:account-check-outline"></span><div style="font-size:18px;font-weight:700;">Community Required</div></div>
            <div style="opacity:0.85;margin-bottom:16px;">${onb.onboardingWelcome || 'Join our official channel and sponsor group to continue.'}</div>
            ${chUser ? `<a id="onbJoinChannel" class="btn btn-secondary" style="width:100%;margin-bottom:10px;text-align:center;">Join Channel (@${chUser})</a>` : ''}
            ${grUser ? `<a id="onbJoinGroup" class="btn btn-secondary" style="width:100%;margin-bottom:10px;text-align:center;">Join Sponsor Group (@${grUser})</a>` : ''}
            <button id="onbCheckBtn" class="btn btn-primary" style="width:100%">Check</button>
            <div id="onbStatus" style="margin-top:10px;min-height:20px;font-size:13px;opacity:0.9"></div>
        `;
        modal.appendChild(card);
        document.body.appendChild(modal);
        try { localStorage.setItem(seenKey, '1'); } catch(_) {}

        const openTg = (url) => { try { if (window.Telegram?.WebApp?.openTelegramLink) return window.Telegram.WebApp.openTelegramLink(url); } catch(_) {} window.open(url,'_blank'); };
        if (chUser && document.getElementById('onbJoinChannel')) document.getElementById('onbJoinChannel').addEventListener('click', (e)=>{ e.preventDefault(); openTg(`https://t.me/${chUser}`); });
        if (grUser && document.getElementById('onbJoinGroup')) document.getElementById('onbJoinGroup').addEventListener('click', (e)=>{ e.preventDefault(); openTg(`https://t.me/${grUser}`); });
        document.getElementById('onbCheckBtn').addEventListener('click', async () => {
            try {
                const resp = await fetch('/api/verify-onboarding-joins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telegramId: userId }) });
                const r = await resp.json();
                if (r.ok) modal.remove();
                else { const s = document.getElementById('onbStatus'); s.textContent = 'You must join both the official channel and sponsor group to continue.'; s.style.color='#ff6b6b'; }
            } catch(_){}
        });
    } catch (_) {}
}

async function loadLeaderboard() {
    try {
        const data = await apiCall('/api/leaderboard?limit=10');
        renderLeaderboard(data.leaderboard);
    } catch (error) {
        document.getElementById('leaderboardContent').innerHTML = showError('Failed to load leaderboard');
    }
}

function renderLeaderboard(leaderboard) {
    let html = '';
    leaderboard.forEach((user, index) => {
        const rank = index + 1;
        const name = user.first_name || user.username || 'Anonymous';
        
        html += `
            <div class="leaderboard-item">
                <div class="rank ${getRankClass(rank)}">${rank}</div>
                <div class="player-info">
                    <div class="player-name">${name}</div>
                    <div class="player-stats">${user.friends_invited} friends invited</div>
                </div>
                <div class="player-points">${formatNumber(user.total_earned != null ? user.total_earned : (user.total_points_earned || 0))}</div>
            </div>
        `;
    });

    document.getElementById('leaderboardContent').innerHTML = html;
}

async function loadTasks(platform = 'telegram') {
    try {
        console.log('Loading tasks for user:', userId, 'platform:', platform);
        const data = await apiCall(`/api/tasks/${userId}`);
        console.log('Tasks data received:', data);
        renderTasks(data, platform);
    } catch (error) {
        console.error('Error loading tasks:', error);
        document.getElementById('tasksContent').innerHTML = showError('Failed to load tasks');
    }
}

function renderTasks(tasks, platform = 'telegram') {
    let html = '';
    
    if (platform === 'telegram') {
        // Channels
        if (tasks.channels && tasks.channels.length > 0) {
            html += '<h3 style="margin-bottom: 16px; font-size: 18px; font-weight: 600;"><span class="iconify" data-icon="mdi:television-classic"></span> Join Channels</h3>';
            tasks.channels.forEach(channel => {
                const isCompleted = channel.is_joined || false;
                html += `
                    <div class="task-card">
                        <div class="task-header">
                            <div class="task-title">${channel.channel_name}</div>
                            <div class="task-points">+${channel.points_reward}</div>
                        </div>
                        <div class="task-description">${channel.description ? channel.description : ''}</div>
                        <div class="task-actions">
                            <a href="${channel.channel_link}" target="_blank" class="btn btn-secondary">
                                <span class="iconify" data-icon="mdi:open-in-new"></span> Join
                            </a>
                            <button class="btn btn-primary claim-channel-btn" data-channel-id="${channel.id}" ${isCompleted ? 'disabled' : ''}>
                                ${isCompleted ? '<span class="iconify" data-icon="mdi:check-circle-outline"></span> Claimed' : '<span class="iconify" data-icon="mdi:television-classic"></span> Claim'}
                            </button>
                        </div>
                    </div>
                `;
            });
        }

        // Groups
        if (tasks.groups && tasks.groups.length > 0) {
            html += '<h3 style="margin-bottom: 16px; font-size: 18px; font-weight: 600;"><span class="iconify" data-icon="mdi:account-group-outline"></span> Join Groups</h3>';
            tasks.groups.forEach(group => {
                const isCompleted = group.is_joined || false;
                html += `
                    <div class="task-card">
                        <div class="task-header">
                            <div class="task-title">${group.group_name}</div>
                            <div class="task-points">+${group.points_reward}</div>
                        </div>
                        <div class="task-description">${group.description ? group.description : ''}</div>
                        <div class="task-actions">
                            <a href="${group.group_link}" target="_blank" class="btn btn-secondary">
                                <span class="iconify" data-icon="mdi:open-in-new"></span> Join
                            </a>
                            <button class="btn btn-primary claim-group-btn" data-group-id="${group.id}" ${isCompleted ? 'disabled' : ''}>
                                ${isCompleted ? '<span class="iconify" data-icon="mdi:check-circle-outline"></span> Claimed' : '<span class="iconify" data-icon="mdi:account-group-outline"></span> Claim'}
                            </button>
                        </div>
                    </div>
                `;
            });
        }

        // Show empty state if no tasks
        if ((!tasks.channels || tasks.channels.length === 0) && (!tasks.groups || tasks.groups.length === 0)) {
            html = '<div class="empty-state"><i class="fas fa-inbox"></i><h3>No tasks available</h3><p>Admin hasn\'t added any tasks yet. Check back later!</p></div>';
        }
    } else if (platform === 'whatsapp') {
        if (tasks.whatsapp && tasks.whatsapp.length > 0) {
            html += '<h3 style="margin-bottom: 16px; font-size: 18px; font-weight: 600;">WhatsApp Tasks</h3>';
            tasks.whatsapp.forEach(t => {
                const isPending = t.claim_status === 'pending';
                html += `
                    <div class="task-card">
                        <div class="task-header">
                            <div class="task-title">${t.task_name}</div>
                            <div class="task-points">+${t.points_reward}</div>
                        </div>
                        <div class="task-description">${t.description ? t.description : ''}</div>
                        <div class="task-actions">
                            <a href="${t.task_link}" target="_blank" class="btn btn-secondary">Open</a>
                            ${isPending ? `
                                <button class="btn btn-secondary social-pending" data-social-id="${t.id}" disabled>
                                    Pending...
                                </button>
                            ` : `
                                <button class="btn btn-primary social-claim-btn" data-social-id="${t.id}">
                                    Claim
                                </button>
                            `}
                        </div>
                    </div>
                `;
            });
        } else {
            html = '<div class="empty-state"><h3>No WhatsApp tasks</h3><p>Admin hasn\'t added any WhatsApp tasks yet.</p></div>';
        }
    } else if (platform === 'facebook') {
        if (tasks.facebook && tasks.facebook.length > 0) {
            html += '<h3 style="margin-bottom: 16px; font-size: 18px; font-weight: 600;">Facebook Tasks</h3>';
            tasks.facebook.forEach(t => {
                const isPending = t.claim_status === 'pending';
                html += `
                    <div class="task-card">
                        <div class="task-header">
                            <div class="task-title">${t.task_name}</div>
                            <div class="task-points">+${t.points_reward}</div>
                        </div>
                        <div class="task-description">${t.description ? t.description : ''}</div>
                        <div class="task-actions">
                            <a href="${t.task_link}" target="_blank" class="btn btn-secondary">Open</a>
                            ${isPending ? `
                                <button class="btn btn-secondary social-pending" data-social-id="${t.id}" disabled>
                                    Pending...
                                </button>
                            ` : `
                                <button class="btn btn-primary social-claim-btn" data-social-id="${t.id}">
                                    Claim
                                </button>
                            `}
                        </div>
                    </div>
                `;
            });
        } else {
            html = '<div class="empty-state"><h3>No Facebook tasks</h3><p>Admin hasn\'t added any Facebook tasks yet.</p></div>';
        }
    } else if (platform === 'tiktok') {
        if (tasks.tiktok && tasks.tiktok.length > 0) {
            html += '<h3 style="margin-bottom: 16px; font-size: 18px; font-weight: 600;">TikTok Tasks</h3>';
            tasks.tiktok.forEach(t => {
                const isPending = t.claim_status === 'pending';
                html += `
                    <div class="task-card">
                        <div class="task-header">
                            <div class="task-title">${t.task_name}</div>
                            <div class="task-points">+${t.points_reward}</div>
                        </div>
                        <div class="task-description">${t.description ? t.description : ''}</div>
                        <div class="task-actions">
                            <a href="${t.task_link}" target="_blank" class="btn btn-secondary">Open</a>
                            ${isPending ? `
                                <button class="btn btn-secondary social-pending" data-social-id="${t.id}" disabled>
                                    Pending...
                                </button>
                            ` : `
                                <button class="btn btn-primary social-claim-btn" data-social-id="${t.id}">
                                    Claim
                                </button>
                            `}
                        </div>
                    </div>
                `;
            });
        } else {
            html = '<div class="empty-state"><h3>No TikTok tasks</h3><p>Admin hasn\'t added any TikTok tasks yet.</p></div>';
        }
    } else if (platform === 'website') {
        if (tasks.website && tasks.website.length > 0) {
            html += '<h3 style="margin-bottom: 16px; font-size: 18px; font-weight: 600;">Website Tasks</h3>';
            tasks.website.forEach(t => {
                const isPending = t.claim_status === 'pending';
                html += `
                    <div class="task-card">
                        <div class="task-header">
                            <div class="task-title">${t.task_name}</div>
                            <div class="task-points">+${t.points_reward}</div>
                        </div>
                        <div class="task-description">${t.description ? t.description : ''}</div>
                        <div class="task-actions">
                            <a href="${t.task_link}" target="_blank" class="btn btn-secondary">Open</a>
                            ${isPending ? `
                                <button class="btn btn-secondary social-pending" data-social-id="${t.id}" disabled>
                                    Pending...
                                </button>
                            ` : `
                                <button class="btn btn-primary social-claim-btn" data-social-id="${t.id}">
                                    Claim
                                </button>
                            `}
                        </div>
                    </div>
                `;
            });
        } else {
            html = '<div class="empty-state"><h3>No Website tasks</h3><p>Admin hasn\'t added any Website tasks yet.</p></div>';
        }
    }

    document.getElementById('tasksContent').innerHTML = html;

    // Attach delegated click handlers for claim buttons
    try {
        const container = document.getElementById('tasksContent');
        if (container && !container._claimHandlersBound) {
            container.addEventListener('click', async (e) => {
                const channelBtn = e.target.closest('.claim-channel-btn');
                if (channelBtn) {
                    const id = parseInt(channelBtn.getAttribute('data-channel-id'));
                    if (!isNaN(id)) await claimChannelJoin(id);
                    return;
                }
                const groupBtn = e.target.closest('.claim-group-btn');
                if (groupBtn) {
                    const id = parseInt(groupBtn.getAttribute('data-group-id'));
                    if (!isNaN(id)) await claimGroupJoin(id);
                    return;
                }
                const socialBtn = e.target.closest('.social-claim-btn');
                if (socialBtn) {
                    const id = parseInt(socialBtn.getAttribute('data-social-id'));
                    if (!isNaN(id)) await startSocialClaim(id, socialBtn);
                    return;
                }
                const pendingInfo = e.target.closest('.social-pending');
                if (pendingInfo) {
                    const id = parseInt(pendingInfo.getAttribute('data-social-id'));
                    if (!isNaN(id)) await startSocialClaim(id);
                    return;
                }
            });
            container._claimHandlersBound = true;
        }
    } catch (err) {
        console.error('Failed to bind claim handlers', err);
    }
}

async function loadEarnData() {
    try {
        console.log('Loading earn data for user:', userId);
        const data = await apiCall(`/api/earn-status/${userId}`);
        console.log('Earn data received:', data);
        renderEarnData(data);
    } catch (error) {
        console.error('Error loading earn data:', error);
        document.getElementById('earnHistory').innerHTML = showError('Failed to load earn data');
    }
}

function renderEarnData(earnData) {
    const { claimsRemaining, totalClaims, claimHistory } = earnData;
    
    document.getElementById('earnProgress').textContent = `${totalClaims - claimsRemaining}/${totalClaims}`;
    // Countdown to next claim if none remaining
    const claimBtn = document.getElementById('claimBtn');
    let nextAtEl = document.getElementById('nextClaimAt');
    if (!nextAtEl) {
        const holder = claimBtn ? claimBtn.parentElement : document.getElementById('earnHistory');
        const div = document.createElement('div');
        div.id = 'nextClaimAt';
        div.style.textAlign = 'center';
        div.style.fontSize = '12px';
        div.style.marginTop = '8px';
        holder.insertBefore(div, holder.children[holder.children.length - 1]);
        nextAtEl = div;
    }
    if (claimsRemaining <= 0 && claimHistory && claimHistory.length > 0) {
        const last = claimHistory[0];
        const lastTime = new Date(last.claimed_at).getTime();
        const target = lastTime + 24*60*60*1000;
        startCountdown(target, nextAtEl, claimBtn);
    } else if (nextAtEl) {
        nextAtEl.textContent = '';
    }
    
    // Render claim history
    let historyHtml = '';
    if (claimHistory && claimHistory.length > 0) {
        claimHistory.forEach(claim => {
            const date = new Date(claim.claimed_at).toLocaleDateString();
            historyHtml += `
                <div class="history-item">
                    <div class="history-header">
                        <div class="history-title">Daily Reward</div>
                        <div class="history-amount">+${claim.points_earned}</div>
                    </div>
                    <div class="history-date">${date}</div>
                </div>
            `;
        });
    } else {
        historyHtml = '<div class="empty-state"><span class="iconify" data-icon="mdi:gift-outline"></span><h3>No claims yet</h3><p>Start claiming your daily rewards!</p></div>';
    }
    
    document.getElementById('earnHistory').innerHTML = historyHtml;
}

let countdownTimer = null;
function startCountdown(targetMs, mountEl, claimBtn) {
    if (countdownTimer) clearInterval(countdownTimer);
    function tick() {
        const now = Date.now();
        const diff = targetMs - now;
        if (diff <= 0) {
            clearInterval(countdownTimer);
            mountEl.textContent = 'You can claim now.';
            if (claimBtn) claimBtn.disabled = false;
            return;
        }
        const h = Math.floor(diff/3600000);
        const m = Math.floor((diff%3600000)/60000);
        const s = Math.floor((diff%60000)/1000);
        mountEl.textContent = `Next claim in ${h}h ${m}m ${s}s`;
        if (claimBtn) claimBtn.disabled = true;
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
}

async function loadHistory(type = 'withdrawals') {
    try {
        const data = await apiCall(`/api/history/${userId}?type=${type}`);
        renderHistory(data, type);
    } catch (error) {
        document.getElementById('historyContent').innerHTML = showError('Failed to load history');
    }
}

function renderHistory(historyData, type) {
    let html = '';
    
    if (type === 'withdrawals') {
        if (historyData.withdrawals && historyData.withdrawals.length > 0) {
            historyData.withdrawals.forEach(withdrawal => {
                const date = new Date(withdrawal.created_at).toLocaleDateString();
                const statusClass = withdrawal.status === 'pending' ? 'status-pending' : 
                                  withdrawal.status === 'completed' ? 'status-completed' : 'status-failed';
                const recvPts = (withdrawal.receivable_points != null) ? withdrawal.receivable_points : withdrawal.amount;
                const recvCur = (withdrawal.receivable_currency_amount != null) ? Number(withdrawal.receivable_currency_amount) : null;
                
                html += `
                    <div class="history-item">
                        <div class="history-header">
                            <div class="history-title">Withdrawal</div>
                            <div class="history-amount">-${formatNumber(recvPts)} pts</div>
                        </div>
                        <div class="history-sub">
                            <div class="history-date">${date}</div>
                            <div class="history-status ${statusClass}">${withdrawal.status}</div>
                        </div>
                        ${recvCur != null ? `<div class="history-date">Receives: ${recvCur.toFixed(2)}</div>` : ''}
                    </div>
                `;
            });
        } else {
            html = '<div class="empty-state"><span class="iconify" data-icon="mdi:cash"></span><h3>No withdrawals</h3><p>You haven\'t made any withdrawals yet.</p></div>';
        }
    } else if (type === 'earnings') {
        if (historyData.earnings && historyData.earnings.length > 0) {
            historyData.earnings.forEach(earning => {
                const date = new Date(earning.earned_at).toLocaleDateString();
                
                html += `
                    <div class="history-item">
                        <div class="history-header">
                            <div class="history-title">${earning.task_name || 'Task Reward'}</div>
                            <div class="history-amount">+${earning.points_earned}</div>
                        </div>
                        <div class="history-date">${date}</div>
                    </div>
                `;
            });
        } else {
            html = '<div class="empty-state"><span class="iconify" data-icon="mdi:coins"></span><h3>No earnings</h3><p>Complete tasks to start earning!</p></div>';
        }
    }
    
    document.getElementById('historyContent').innerHTML = html;
}

async function loadWithdrawData() {
    try {
        const data = await apiCall(`/api/bank-details/${userId}`);
        document.getElementById('withdrawBalance').textContent = formatNumber(userData.points || 0);
        
        if (data.bank_details) {
            const acc = String(data.bank_details.account_number || '');
            const masked = acc.replace(/\d(?=\d{4})/g, '•');
            document.getElementById('bankAccount').value = `${data.bank_details.account_name} - ${masked} (${data.bank_details.bank_name})`;
        } else {
            document.getElementById('bankAccount').value = 'No bank details added';
        }
    } catch (error) {
        console.error('Error loading withdraw data:', error);
    }
}

async function loadBankData() {
    try {
        const data = await apiCall(`/api/bank-details/${userId}`);
        
        if (data.bank_details) {
            document.getElementById('accountName').value = data.bank_details.account_name;
            document.getElementById('accountNumber').value = data.bank_details.account_number;
            document.getElementById('bankSelect').value = data.bank_details.bank_name.toLowerCase();
        }
    } catch (error) {
        console.error('Error loading bank data:', error);
    }
}

async function loadInviteData() {
    try {
        const data = await apiCall(`/api/user/${userId}/referral`);
        
        document.getElementById('referralLinkInput').value = data.referralLink;
        
        // Add click event to copy button (robust, multi-strategy)
        const copyButton = document.getElementById('copyButton');
        if (copyButton) {
            copyButton.addEventListener('click', async function(e) {
                e.preventDefault();
                const input = document.getElementById('referralLinkInput');
                if (!input || !input.value) {
                    if (tg && tg.showAlert) tg.showAlert('❌ No link to copy!');
                    else alert('❌ No link to copy!');
                    return;
                }
                const text = input.value;
                let copied = false;
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(text);
                        copied = true;
                    }
                } catch (err) {
                    // ignore and fallback
                }
                if (!copied) {
                    try {
                        const tempTextArea = document.createElement('textarea');
                        tempTextArea.value = text;
                        tempTextArea.setAttribute('readonly', '');
                        tempTextArea.style.position = 'absolute';
                        tempTextArea.style.left = '-9999px';
                        document.body.appendChild(tempTextArea);
                        tempTextArea.select();
                        tempTextArea.setSelectionRange(0, text.length);
                        copied = document.execCommand('copy');
                        document.body.removeChild(tempTextArea);
                    } catch (err) {
                        copied = false;
                    }
                }
                if (copied) {
                    copyButton.innerHTML = '✅';
                    copyButton.style.backgroundColor = '#4CAF50';
                    if (tg && tg.showAlert) tg.showAlert('✅ Link copied successfully!');
                    else alert('✅ Link copied successfully!');
                    setTimeout(() => {
                        copyButton.innerHTML = '<span class="iconify" data-icon="mdi:content-copy"></span>';
                        copyButton.style.backgroundColor = '';
                    }, 1800);
                } else {
                    if (tg && tg.showAlert) tg.showAlert('❌ Copy failed. Please select and copy manually.');
                    else alert('❌ Copy failed. Please select and copy manually.');
                }
            });
        }
        document.getElementById('totalReferred').textContent = data.totalReferred || 0;
        document.getElementById('referralEarnings').textContent = `₦${formatNumber(data.referralEarnings || 0)}`;
    } catch (error) {
        console.error('Error loading invite data:', error);
    }
}

async function loadTeamData() {
    try {
        const data = await apiCall(`/api/user/${userId}/team`);
        let html = '';
        
        if (data.teamMembers && data.teamMembers.length > 0) {
            data.teamMembers.forEach(member => {
                const name = `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'User';
                const statusLabel = member.status === 'success' ? 'Success' : 'In Review';
                const statusClass = member.status === 'success' ? 'status-completed' : 'status-pending';
                html += `
                    <div class="history-item">
                        <div class="history-header">
                            <div class="history-title">${name}</div>
                            <div class="history-status ${statusClass}">${statusLabel}</div>
                        </div>
                        <div class="history-date">Joined ${new Date(member.created_at).toLocaleDateString()}</div>
                    </div>
                `;
            });
        } else {
            html = '<div class="empty-state"><span class="iconify" data-icon="mdi:account-group-outline"></span><h3>No team members yet</h3><p>Share your referral link to start building your team!</p></div>';
        }
        
        document.getElementById('teamContent').innerHTML = html;
    } catch (error) {
        document.getElementById('teamContent').innerHTML = showError('Failed to load team data');
    }
}

// Form setup functions
function setupWithdrawForm() {
    document.getElementById('withdrawForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const amount = parseInt(document.getElementById('withdrawAmount').value);
        const minWithdrawal = window.__minWithdrawalPoints || 1000;
        
        if (amount < minWithdrawal) {
            if (tg && tg.showAlert) tg.showAlert(`❌ Minimum withdrawal is ${minWithdrawal} points`);
            else alert(`Minimum withdrawal is ${minWithdrawal} points`);
            return;
        }
        
        if (amount > (userData?.points || 0)) {
            if (tg && tg.showAlert) tg.showAlert('❌ Insufficient points');
            else alert('Insufficient points');
            return;
        }
        
        try {
            const response = await apiCall('/api/withdraw', {
                method: 'POST',
                body: JSON.stringify({ telegramId: userId, amount })
            });

            if (response.success) {
                if (tg && tg.showAlert) tg.showAlert('✅ Withdrawal request submitted successfully!');
                else alert('Withdrawal request submitted successfully!');
                router.navigate('/');
                await loadUserData();
            }
        } catch (error) {
            if (tg && tg.showAlert) tg.showAlert('❌ ' + error.message);
            else alert(error.message || 'Error creating withdrawal');
        }
    });
}

function setupBankForm() {
    document.getElementById('bankForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const accountName = document.getElementById('accountName').value;
        const accountNumber = document.getElementById('accountNumber').value;
        const bankCode = document.getElementById('bankSelect').value;
        
        if (!accountName || !accountNumber || !bankCode) {
            tg.showAlert('❌ Please fill all fields');
            return;
        }
        
        try {
            const response = await apiCall('/api/bank-details', {
                method: 'POST',
                body: JSON.stringify({ 
                    telegramId: userId, 
                    accountName, 
                    accountNumber, 
                    bankCode 
                })
            });

            if (response.success) {
                tg.showAlert('✅ Bank details saved successfully!');
                router.navigate('/');
            }
        } catch (error) {
            tg.showAlert('❌ ' + error.message);
        }
    });
}

// Action functions
async function claimReward() {
    const claimBtn = document.getElementById('claimBtn');
    const claimSpinner = document.getElementById('claimSpinner');
    
    if (!claimBtn || !claimSpinner) {
        console.error('Claim button elements not found');
        return;
    }
    
    claimBtn.disabled = true;
    claimSpinner.style.display = 'block';
    
    try {
        console.log('Claiming reward for user:', userId);
        const response = await apiCall('/api/claim-reward', {
            method: 'POST',
            body: JSON.stringify({ telegramId: userId })
        });

        console.log('Claim response:', response);

        if (response.success) {
            if (tg && tg.showAlert) tg.showAlert(`🎉 Congratulations! You earned ${response.pointsEarned} points!`);
            else alert(`Congratulations! You earned ${response.pointsEarned} points!`);
            await loadUserData();
            await loadEarnData();
        } else {
            if (tg && tg.showAlert) tg.showAlert(`❌ ${response.message || 'Failed to claim reward'}`);
            else alert(response.message || 'Failed to claim reward');
        }
    } catch (error) {
        console.error('Error claiming reward:', error);
        if (tg && tg.showAlert) tg.showAlert('❌ ' + (error.message || 'Failed to claim reward'));
        else alert(error.message || 'Failed to claim reward');
    } finally {
        claimBtn.disabled = false;
        claimSpinner.style.display = 'none';
    }
}

async function claimChannelJoin(channelId) {
    try {
        const response = await apiCall('/api/verify-channel-membership', {
            method: 'POST',
            body: JSON.stringify({ telegramId: userId, channelId })
        });

        if (response.success && response.isMember) {
            tg.showAlert(`✅ Successfully claimed ${response.pointsEarned} points!`);
            await loadUserData();
            loadTasks('telegram');
        } else {
            const msg = response.message || 'You must join first before claiming.';
            if (tg && tg.showAlert) tg.showAlert(`❌ ${msg}`);
            else alert(msg);
        }
    } catch (error) {
        console.error('Error claiming channel join:', error);
        tg.showAlert('❌ ' + error.message);
    }
}

async function claimGroupJoin(groupId) {
    try {
        const response = await apiCall('/api/verify-group-membership', {
            method: 'POST',
            body: JSON.stringify({ telegramId: userId, groupId })
        });

        if (response.success && response.isMember) {
            tg.showAlert(`✅ Successfully claimed ${response.pointsEarned} points!`);
            await loadUserData();
            loadTasks('telegram');
        } else {
            const msg = response.message || 'You must join first before claiming.';
            if (tg && tg.showAlert) tg.showAlert(`❌ ${msg}`);
            else alert(msg);
        }
    } catch (error) {
        console.error('Error claiming group join:', error);
        tg.showAlert('❌ ' + error.message);
    }
}

async function startSocialClaim(socialTaskId, buttonEl) {
    try {
        // Create pending claim
        const req = await apiCall('/api/social/claim-request', {
            method: 'POST',
            body: JSON.stringify({ telegramId: userId, socialTaskId })
        });
        if (req && req.success) {
            if (buttonEl) {
                buttonEl.disabled = true;
                buttonEl.innerHTML = '<span class="iconify" data-icon="mdi:clock-outline"></span> Pending...';
            }
            // Poll until available
            const poll = async () => {
                try {
                    const res = await apiCall('/api/social/claim-complete', {
                        method: 'POST',
                        body: JSON.stringify({ telegramId: userId, socialTaskId })
                    });
                    if (res && res.success && res.status === 'completed') {
                        if (tg && tg.showAlert) tg.showAlert(`✅ Claimed ${res.pointsEarned} points!`); else alert(`Claimed ${res.pointsEarned} points!`);
                        await loadUserData();
                        // Refresh current tab to remove completed task
                        const active = document.querySelector('.tabs .tab.active');
                        const current = active ? active.dataset.taskTab : 'telegram';
                        loadTasks(current);
                        return;
                    }
                } catch (_) { /* ignore */ }
                setTimeout(poll, 10000); // 10s interval
            };
            setTimeout(poll, 10000);
        }
    } catch (err) {
        if (tg && tg.showAlert) tg.showAlert('❌ ' + (err.message || 'Failed to start claim'));
        else alert(err.message || 'Failed to start claim');
    }
}

// Copy function is now handled by event listener in loadInviteData()

async function contactAdmin() {
    console.log('Contact admin clicked');
    try {
        const response = await apiCall('/api/admin/contact');
        const adminUsername = (response && response.adminUsername) ? response.adminUsername : null;
        if (!adminUsername) {
            if (tg && tg.showAlert) tg.showAlert('❌ Admin username not configured');
            else alert('❌ Admin username not configured');
            return;
        }
        const message = `Hi! I need help with my TGTask account. My Telegram ID: ${userId}`;
        const url = `https://t.me/${adminUsername}?text=${encodeURIComponent(message)}`;
        console.log('Opening admin link:', url);
        if (tg && tg.showAlert) await tg.showAlert(`Opening chat with @${adminUsername}...`);
        // Try Telegram WebApp API first
        let opened = false;
        try {
            if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openTelegramLink) {
                window.Telegram.WebApp.openTelegramLink(url);
                opened = true;
            }
        } catch (e) {
            opened = false;
        }
        // Fallbacks
        if (!opened) {
            try {
                window.location.href = url;
                opened = true;
            } catch (e) { /* ignore */ }
        }
        if (!opened) {
            try {
                window.open(url, '_blank');
            } catch (e) {
                if (tg && tg.showAlert) tg.showAlert('❌ Unable to open Telegram. Please contact admin manually.');
                else alert('❌ Unable to open Telegram. Please contact admin manually.');
            }
        }
    } catch (error) {
        console.error('Error getting admin contact:', error);
        if (tg && tg.showAlert) tg.showAlert('❌ Could not get admin contact');
        else alert('❌ Could not get admin contact');
    }
}

   function toggleFaq(faqId) {
      try {
          const content = document.getElementById(faqId + '-content');
          const arrow = document.getElementById(faqId + '-arrow');
          if (!content) return;
          const willOpen = !content.classList.contains('open');
          document.querySelectorAll('.faq-content').forEach(item => item.classList.remove('open'));
          document.querySelectorAll('[id$="-arrow"]').forEach(item => item.classList.remove('rotated'));
          if (willOpen) {
              content.classList.add('open');
              if (arrow) arrow.classList.add('rotated');
          }
      } catch (e) {
          console.error('toggleFaq error', e);
      }
  }

// Make functions globally accessible
window.claimReward = claimReward;
window.claimChannelJoin = claimChannelJoin;
window.claimGroupJoin = claimGroupJoin;
window.contactAdmin = contactAdmin;
window.toggleFaq = toggleFaq;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Try to sync Telegram profile so backend has username/first/last
    (async () => {
        try {
            if (telegramUser && userId) {
                await fetch('/api/user/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        telegramId: userId,
                        username: telegramUser.username || null,
                        first_name: telegramUser.first_name || null,
                        last_name: telegramUser.last_name || null
                    })
                }).catch(() => {});
            }
        } catch (_) {}
    })();
    // Initialize router
    router.init();
    
    // Ensure bottom padding accommodates fixed footer height (dynamic)
    const adjustContentPadding = () => {
        const footer = document.getElementById('footerNav');
        const main = document.getElementById('main-content');
        if (footer && main) {
            const footerHeight = footer.getBoundingClientRect().height;
            main.style.paddingBottom = `${Math.ceil(footerHeight + 24)}px`;
        }
    };
    adjustContentPadding();
    window.addEventListener('resize', adjustContentPadding);
    // Re-adjust after each route change
    const originalNavigate = router.navigate.bind(router);
    router.navigate = (path, updateHistory = true) => {
        originalNavigate(path, updateHistory);
        setTimeout(adjustContentPadding, 0);
    };

    // Add footer navigation event listeners
    document.querySelectorAll('.footer-nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const path = item.getAttribute('href');
            router.navigate(path);
            setTimeout(() => {
                const adjust = () => adjustContentPadding();
                adjust();
            }, 0);
        });
    });
    
    // Ensure Contact Admin link always triggers
    document.addEventListener('click', (e) => {
        const contactLink = e.target.closest('#contactAdminLink');
        if (contactLink) {
            e.preventDefault();
            contactAdmin();
            return;
        }
    }, true);

    // Add menu item event listeners for internal navigation
    document.addEventListener('click', (e) => {
        if (e.target.closest('.menu-item') && e.target.closest('.menu-item').getAttribute('href')) {
            e.preventDefault();
            const href = e.target.closest('.menu-item').getAttribute('href');
            if (href && href !== '#') {
                router.navigate(href);
            }
        }
    });
});
