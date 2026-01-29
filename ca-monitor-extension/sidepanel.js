// ============ 全局变量 ============
var SERVER = 'https://tingfeng.ai';

var contracts = [];
var groups = {};
var groupFilter = 'all';
var chainFilter = 'all';
var mcFilter = 'all';
var eventSource = null;
var editUser = null;
var editGroup = null;
var audioCtx = null;
var currentView = 'contracts';
var currentRankingType = 'groups';
var groupRankings = [];
var callRankings = [];

var data = {
    special: {},
    blocked: {},
    userRemarks: {},
    groupRemarks: {},
    enabledGroups: {},
    platform: 'gmgn',
    mc: { 
        col1Min: 0, col1Max: 100000,
        col2Min: 100000, col2Max: 1000000,
        col3Min: 1000000, col3Max: 0
    }
};

// ============ 工具函数 ============
function $(id) { return document.getElementById(id); }

function toast(m, t) {
    var e = $('toast');
    e.textContent = m;
    e.className = 'toast show ' + (t || '');
    setTimeout(function() { e.className = 'toast'; }, 2000);
}

function formatMC(n) {
    n = parseFloat(n) || 0;
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return n > 0 ? '$' + n.toFixed(0) : '-';
}

function formatShort(n) {
    n = parseFloat(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return n.toFixed(0);
}

// ============ 存储 ============
function saveData() {
    try { localStorage.setItem('ca_ext', JSON.stringify(data)); } catch (e) { }
}

function loadData() {
    try {
        var s = localStorage.getItem('ca_ext');
        if (s) data = Object.assign(data, JSON.parse(s));
    } catch (e) { }
}

// ============ 音频 ============
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function beep(f, d) {
    try {
        initAudio();
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.connect(g);
        g.connect(audioCtx.destination);
        o.frequency.value = f;
        g.gain.setValueAtTime(0.4, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + d);
        o.start(audioCtx.currentTime);
        o.stop(audioCtx.currentTime + d);
    } catch (e) { }
}

function playNormal() { beep(800, 0.2); }

function playSpecial() {
    beep(880, 0.15);
    setTimeout(function() { beep(1100, 0.25); }, 150);
}

function testNotify() {
    playSpecial();
    toast('🔔 通知测试', 'success');
}

// ============ 链接 ============
function getLink(c) {
    var addr = c.address;
    var chain = (c.detectedChain || c.chain || 'bsc').toLowerCase();
    
    if (data.platform === 'debot') {
        var debotMap = { 
            solana: 'solana', sol: 'solana',
            bsc: 'bsc', 
            base: 'base', 
            eth: 'eth',
            monad: 'monad',
            xlayer: 'xlayer'
        };
        return 'https://debot.ai/token/' + (debotMap[chain] || 'bsc') + '/XRZeth_' + addr;
    }
    
    
    // AVE
    if (data.platform === 'ave') {
        var aveMap = { 
            solana: 'solana', sol: 'solana',
            bsc: 'bsc', 
            base: 'base', 
            eth: 'ethereum',
            monad: 'monad',
            tron: 'tron',
            xlayer: 'xlayer'
        };
        return 'https://ave.ai/token/' + addr + '-' + (aveMap[chain] || 'bsc') + '?ref={0xaodi9981}';
    }
    
    // GMGN
    var gmgnMap = { 
        solana: 'sol', sol: 'sol',
        bsc: 'bsc', 
        base: 'base', 
        eth: 'eth', 
        tron: 'tron',
        monad: 'monad',
        xlayer: 'xlayer'
    };
    return 'https://gmgn.ai/' + (gmgnMap[chain] || 'bsc') + '/token/yaqTvGCf_' + addr;
}

// ============ 弹窗 ============
function openSettings() {
    $('mc1MinInput').value = data.mc.col1Min;
    $('mc1MaxInput').value = data.mc.col1Max;
    $('mc2MinInput').value = data.mc.col2Min;
    $('mc2MaxInput').value = data.mc.col2Max;
    $('mc3MinInput').value = data.mc.col3Min;
    $('settingsModal').classList.add('active');
}

function closeSettings() {
    $('settingsModal').classList.remove('active');
}

function closeModal(id) {
    $(id).classList.remove('active');
}

function saveSettings() {
    data.mc.col1Min = parseInt($('mc1MinInput').value) || 0;
    data.mc.col1Max = parseInt($('mc1MaxInput').value) || 100000;
    data.mc.col2Min = parseInt($('mc2MinInput').value) || 100000;
    data.mc.col2Max = parseInt($('mc2MaxInput').value) || 1000000;
    data.mc.col3Min = parseInt($('mc3MinInput').value) || 1000000;
    data.mc.col3Max = 0;
    
    saveData();
    updateLabels();
    closeSettings();
    toast('✅ 已保存', 'success');
}

function updateLabels() {
    $('col1Range').textContent = formatShort(data.mc.col1Min) + '-' + formatShort(data.mc.col1Max);
    $('col2Range').textContent = formatShort(data.mc.col2Min) + '-' + formatShort(data.mc.col2Max);
    $('col3Range').textContent = formatShort(data.mc.col3Min) + '+';
}

// ============ 下拉菜单 ============
function toggleDropdown(t) {
    $(t + 'Dropdown').classList.toggle('show');
}

function closeAllDropdowns() {
    $('chainDropdown').classList.remove('show');
    $('platformDropdown').classList.remove('show');
}

function selectChain(v) {
    chainFilter = v;
    $('chainText').textContent = v === 'all' ? '全部链' : v.toUpperCase();
    closeAllDropdowns();
    render();
}

function selectPlatform(v) {
    data.platform = v;
    saveData();
    $('platformText').textContent = v.toUpperCase();
    closeAllDropdowns();
    toast('切换到 ' + v.toUpperCase(), 'success');
}

// ============ 过滤 ============
function setMcFilter(f) {
    mcFilter = f;
    document.querySelectorAll('.mc-filter-btn').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-mc') === f);
    });
    render();
}

function setGroupFilter(f) {
    groupFilter = f;
    document.querySelectorAll('.group-tab').forEach(function(t) {
        var tf = t.getAttribute('data-filter');
        t.classList.toggle('active', tf === f);
    });
    render();
}

// ============ 关注提示 ============
function showAttention(c, triggerUserId, triggerUserNick) {
    var userName = data.userRemarks[triggerUserId] || triggerUserNick || '关注用户';
    $('attentionText').textContent = userName + ' 发现: ' + (c.tokenSymbol || '新代币');
    $('attentionPopup').classList.add('show');
    setTimeout(function() { $('attentionPopup').classList.remove('show'); }, 3000);
}

// ============ SSE ============
function connectSSE() {
    if (eventSource) eventSource.close();
    $('statusDot').classList.remove('connected');
    $('statusText').textContent = '连接中...';

    try {
        eventSource = new EventSource(SERVER + '/api/events');
        
        eventSource.onopen = function() {
            $('statusDot').classList.add('connected');
            $('statusText').textContent = '已连接';
        };
        
        eventSource.addEventListener('newContract', function(e) {
            var c = JSON.parse(e.data);
            var idx = contracts.findIndex(function(x) { return x.address === c.address; });
            if (idx >= 0) contracts.splice(idx, 1);
            contracts.unshift(c);
            updateStats();
            
            var isGroupEnabled = (c.sentGroups || [c.fromId]).some(function(g) { return groups[g] && data.enabledGroups[g]; });
            render(isGroupEnabled);
            if (!isGroupEnabled) return;
            
            if (data.special[c.finalFromId]) {
                playSpecial();
                showAttention(c, c.finalFromId, c.userNick);
            } else {
                playNormal();
            }
        });
        
        eventSource.addEventListener('contractUpdated', function(e) {
            var c = JSON.parse(e.data);
            var idx = contracts.findIndex(function(x) { return x.address === c.address; });
            var countChanged = idx >= 0 && c.sendCount > contracts[idx].sendCount;
            if (idx >= 0) {
                contracts.splice(idx, 1);
                contracts.unshift(c);
            }
            updateStats();
            
            var isGroupEnabled = (c.sentGroups || [c.fromId]).some(function(g) { return groups[g] && data.enabledGroups[g]; });
            render(countChanged && isGroupEnabled);
            
            if (countChanged && isGroupEnabled) {
                var lastUserId = c.lastUserId || c.finalFromId;
                var lastUserNick = c.lastUserNick || c.userNick;
                
                if (data.special[lastUserId]) {
                    playSpecial();
                    showAttention(c, lastUserId, lastUserNick);
                } else {
                    playNormal();
                }
            }
        });
        
        eventSource.addEventListener('groupBound', function(e) {
            var d = JSON.parse(e.data);
            groups[d.id] = d;
            renderTabs();
        });
        
        eventSource.addEventListener('groupUnbound', function(e) {
            delete groups[JSON.parse(e.data).id];
            renderTabs();
        });
        
        eventSource.onerror = function() {
            $('statusDot').classList.remove('connected');
            $('statusText').textContent = '已断开';
            setTimeout(connectSSE, 3000);
        };
    } catch (e) {
        $('statusText').textContent = '连接失败';
        setTimeout(connectSSE, 5000);
    }
}

function reconnect() {
    loadContracts();
    loadGroups();
    connectSSE();
}

// ============ 数据加载 ============
function loadContracts() {
    fetch(SERVER + '/api/contracts')
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.code === 200) {
                contracts = d.data || [];
                updateStats();
                render();
            }
        })
        .catch(function(e) { console.error('加载失败', e); });
}

function loadGroups() {
    fetch(SERVER + '/api/monitored-groups')
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.code === 200) {
                groups = d.data || {};
                renderTabs();
            }
        })
        .catch(function(e) { });
}

// ============ 渲染 ============
function updateStats() {
    var ok = function(c) { return !data.blocked[c.finalFromId]; };
    $('totalCount').textContent = contracts.filter(ok).length;
    $('evmCount').textContent = contracts.filter(function(c) { return c.type === 'EVM' && ok(c); }).length;
    $('solCount').textContent = contracts.filter(function(c) { return c.type === 'SOL' && ok(c); }).length;
    $('tronCount').textContent = contracts.filter(function(c) { return c.type === 'TRON' && ok(c); }).length;
}

function renderTabs() {
    var container = $('groupTabs');
    container.innerHTML = '';
    
    var allBtn = document.createElement('button');
    allBtn.className = 'group-tab' + (groupFilter === 'all' ? ' active' : '');
    allBtn.setAttribute('data-filter', 'all');
    allBtn.textContent = '全部';
    allBtn.addEventListener('click', function() { setGroupFilter('all'); });
    container.appendChild(allBtn);
    
    Object.keys(groups).forEach(function(id) {
        if (!data.enabledGroups[id]) return;
        var g = groups[id];
        var btn = document.createElement('button');
        btn.className = 'group-tab' + (groupFilter === id ? ' active' : '');
        btn.setAttribute('data-filter', id);
        btn.textContent = data.groupRemarks[id] || g.name || id.slice(0, 6);
        btn.addEventListener('click', function() { setGroupFilter(id); });
        container.appendChild(btn);
    });
}

function render(isNew) {
    var list = contracts.filter(function(c) {
        if (data.blocked[c.finalFromId]) return false;
        
        var boundIds = Object.keys(groups);
        if (boundIds.length > 0) {
            var hasEnabledGroup = (c.sentGroups || [c.fromId]).some(function(g) { return groups[g] && data.enabledGroups[g]; });
            if (!hasEnabledGroup) return false;
        }
        
        if (groupFilter !== 'all' && (!c.sentGroups || c.sentGroups.indexOf(groupFilter) < 0)) return false;
        if (chainFilter !== 'all') {
            var ch = (c.detectedChain || c.chain || '').toLowerCase();
            if (chainFilter === 'solana' && c.type !== 'SOL') return false;
            if (chainFilter === 'tron' && c.type !== 'TRON') return false;
            if (['bsc', 'base', 'eth', 'monad', 'xlayer'].indexOf(chainFilter) >= 0 && ch !== chainFilter) return false;
        }
        if (mcFilter !== 'all') {
            var mc = parseFloat(c.marketCap) || 0;
            var f = data.mc;
            if (mcFilter === 'col1' && (mc < f.col1Min || mc >= f.col1Max)) return false;
            if (mcFilter === 'col2' && (mc < f.col2Min || mc >= f.col2Max)) return false;
            if (mcFilter === 'col3' && mc < f.col3Min) return false;
        }
        return true;
    });

    var container = $('contractList');
    
    if (!list.length) {
        container.innerHTML = '<div class="empty-state"><div class="icon">📭</div><div>暂无合约</div></div>';
        return;
    }

    container.innerHTML = '';
    
    list.forEach(function(c, i) {
        var cls = c.type === 'SOL' ? 'sol' : (c.type === 'TRON' ? 'tron' : 'evm');
        var mc = parseFloat(c.marketCap) || 0;
        var chg = parseFloat(c.priceChange24h) || 0;
        var groupName = data.groupRemarks[c.fromId] || c.groupName || '';
        var time = c.date ? c.date.split(' ')[1] : '';
        var chainDisplay = (c.detectedChain || c.chain || c.type || '').toUpperCase();
        var callCount = c.sendCount || 1;
        
        // 首Call用户
        var firstUserId = c.finalFromId;
        var firstUserNick = c.userNick;
        var firstUserName = data.userRemarks[firstUserId] || firstUserNick || (firstUserId || '').slice(0, 8);
        var isFirstSpecial = !!data.special[firstUserId];
        
        // 最新发送者（如果和首Call不同且sendCount>1才显示）
        var hasLastSender = c.lastUserId && c.lastUserId !== c.finalFromId && callCount > 1;
        var lastUserId = c.lastUserId;
        var lastUserNick = c.lastUserNick;
        var lastUserName = hasLastSender ? (data.userRemarks[lastUserId] || lastUserNick || (lastUserId || '').slice(0, 8)) : '';
        var isLastSpecial = hasLastSender && !!data.special[lastUserId];
        
        var card = document.createElement('div');
        card.className = 'card' + (isNew && i === 0 ? ' new' : '');
        
        // 用户显示：首Call + 最新发送者
        var userDisplay = '<span class="first-caller-wrap">' + 
            (isFirstSpecial ? '<span class="star">⭐</span>' : '') + 
            '<span class="caller-label first">首</span>' + firstUserName + '</span>';
        
        if (hasLastSender) {
            userDisplay += '<span class="last-caller-wrap">' + 
                (isLastSpecial ? '<span class="star">⭐</span>' : '') + 
                '<span class="caller-label last">新</span>' + lastUserName + '</span>';
        }
        
        card.innerHTML = 
            '<div class="card-header"><div class="card-title-left">' +
            '<span class="token-symbol">' + (c.tokenSymbol || (c.address || '').slice(0, 6)) + '</span>' +
            '<span class="chain-badge ' + cls + '">' + chainDisplay + '</span>' +
            (callCount > 1 ? '<span class="call-badge">' + callCount + 'Call</span>' : '') +
            '</div><div class="card-title-right">' +
            (chg ? '<span class="gain-badge ' + (chg >= 0 ? 'up' : 'down') + '">' + (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%</span>' : '') +
            '<span class="mc-info">' + formatMC(mc) + '</span></div></div>' +
            '<div class="card-stats"><span class="address-short">' + (c.address || '').slice(0, 6) + '...' + (c.address || '').slice(-4) + '</span><span class="card-time">' + time + '</span></div>' +
            '<div class="card-user-row"><span class="card-user-info">' + userDisplay + '</span><span class="card-group">' + groupName + '</span></div>';
        
        card.addEventListener('click', function(e) {
            if (!e.target.closest('.address-short') && !e.target.closest('.first-caller-wrap') && !e.target.closest('.last-caller-wrap') && !e.target.closest('.card-group')) {
                var url = getLink(c);
                if (chrome && chrome.tabs) {
                    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                        if (tabs[0]) {
                            chrome.tabs.update(tabs[0].id, { url: url });
                        }
                    });
                } else {
                    window.open(url, '_self');
                }
            }
        });
        
        var addrEl = card.querySelector('.address-short');
        if (addrEl) {
            addrEl.addEventListener('click', function(e) {
                e.stopPropagation();
                navigator.clipboard.writeText(c.address);
                toast('已复制', 'success');
            });
        }
        
        // 首Call用户点击
        var firstUserEl = card.querySelector('.first-caller-wrap');
        if (firstUserEl) {
            firstUserEl.addEventListener('click', function(e) {
                e.stopPropagation();
                openUser(firstUserId, firstUserNick);
            });
        }
        
        // 最新发送者点击
        var lastUserEl = card.querySelector('.last-caller-wrap');
        if (lastUserEl) {
            lastUserEl.addEventListener('click', function(e) {
                e.stopPropagation();
                openUser(lastUserId, lastUserNick);
            });
        }
        
        var groupEl = card.querySelector('.card-group');
        if (groupEl && c.fromId) {
            groupEl.addEventListener('click', function(e) {
                e.stopPropagation();
                openGroupRemark(c.fromId, c.groupName);
            });
        }
        
        container.appendChild(card);
    });
}

// ============ 用户编辑 ============
function openUser(id, nick) {
    editUser = { id: id, nick: nick };
    $('userIdInput').value = id;
    $('userRemarkInput').value = data.userRemarks[id] || '';
    $('userSpecialCheck').checked = !!data.special[id];
    $('userBlockCheck').checked = !!data.blocked[id];
    $('userTitle').textContent = '编辑: ' + (nick || id);
    $('userModal').classList.add('active');
}

function saveUser() {
    var id = editUser.id;
    var remark = $('userRemarkInput').value.trim();
    if (remark) data.userRemarks[id] = remark;
    else delete data.userRemarks[id];
    
    // 特别关注
    if ($('userSpecialCheck').checked) data.special[id] = true;
    else delete data.special[id];
    
    if ($('userBlockCheck').checked) data.blocked[id] = { nick: editUser.nick, time: new Date().toLocaleString('zh-CN') };
    else delete data.blocked[id];
    saveData();
    closeModal('userModal');
    render();
    updateStats();
    toast('已保存', 'success');
}

// ============ 群组备注编辑 ============
function openGroupRemark(id, name) {
    editGroup = { id: id, name: name };
    $('groupRemarkIdInput').value = id;
    $('groupRemarkNameInput').value = name || '';
    $('groupRemarkInput').value = data.groupRemarks[id] || '';
    $('groupRemarkTitle').textContent = '群组备注';
    $('groupRemarkModal').classList.add('active');
}

function saveGroupRemark() {
    var id = editGroup.id;
    var remark = $('groupRemarkInput').value.trim();
    if (remark) data.groupRemarks[id] = remark;
    else delete data.groupRemarks[id];
    saveData();
    closeModal('groupRemarkModal');
    render();
    renderTabs();
    toast('已保存', 'success');
}

// ============ 群组管理 ============
function openGroupManager() {
    var container = $('groupList');
    var list = Object.keys(groups);
    
    if (!list.length) {
        container.innerHTML = '<div style="text-align:center;color:#555;padding:20px">暂无群组</div>';
    } else {
        container.innerHTML = '';
        list.forEach(function(id) {
            var g = groups[id];
            var displayName = data.groupRemarks[id] || g.name || id;
            var item = document.createElement('div');
            item.className = 'group-item';
            item.innerHTML = '<div><div class="group-item-name">' + displayName + '</div><div class="group-item-id">' + id.slice(0, 20) + '...</div></div>';
            
            var btnWrap = document.createElement('div');
            btnWrap.style.cssText = 'display:flex;gap:4px';
            
            var remarkBtn = document.createElement('button');
            remarkBtn.className = 'group-toggle enabled';
            remarkBtn.textContent = '备注';
            remarkBtn.addEventListener('click', function() { 
                closeModal('groupModal');
                openGroupRemark(id, g.name); 
            });
            
            var toggleBtn = document.createElement('button');
            toggleBtn.className = 'group-toggle ' + (data.enabledGroups[id] ? 'enabled' : 'disabled');
            toggleBtn.textContent = data.enabledGroups[id] ? '监听中' : '未监听';
            toggleBtn.addEventListener('click', function() { toggleGroup(id); });
            
            btnWrap.appendChild(remarkBtn);
            btnWrap.appendChild(toggleBtn);
            item.appendChild(btnWrap);
            container.appendChild(item);
        });
    }
    $('groupModal').classList.add('active');
}

function toggleGroup(id) {
    data.enabledGroups[id] = !data.enabledGroups[id];
    saveData();
    openGroupManager();
    renderTabs();
}

// ============ 黑名单 ============
function openBlockManager() {
    var container = $('blockList');
    var list = Object.keys(data.blocked);
    
    if (!list.length) {
        container.innerHTML = '<div style="text-align:center;color:#555;padding:20px">暂无黑名单</div>';
    } else {
        container.innerHTML = '';
        list.forEach(function(id) {
            var info = data.blocked[id];
            var item = document.createElement('div');
            item.className = 'group-item';
            item.innerHTML = '<div><div class="group-item-name">' + (info.nick || id) + '</div><div class="group-item-id">' + id + '</div></div>';
            
            var btn = document.createElement('button');
            btn.className = 'group-toggle enabled';
            btn.textContent = '取消拉黑';
            btn.addEventListener('click', function() { unblock(id); });
            
            item.appendChild(btn);
            container.appendChild(item);
        });
    }
    $('blockModal').classList.add('active');
}

function unblock(id) {
    delete data.blocked[id];
    saveData();
    openBlockManager();
    render();
    updateStats();
    toast('已取消', 'success');
}

// ============ 排行榜 ============
function switchView(view) {
    currentView = view;
    $('contractsViewTab').classList.toggle('active', view === 'contracts');
    $('rankingViewTab').classList.toggle('active', view === 'ranking');
    $('contractList').classList.toggle('hidden', view !== 'contracts');
    $('filterBar').classList.toggle('hidden', view !== 'contracts');
    $('groupTabs').style.display = view === 'contracts' ? 'flex' : 'none';
    $('rankingPanel').classList.toggle('active', view === 'ranking');
    if (view === 'ranking') loadRankings();
}

function switchRankingType(type) {
    currentRankingType = type;
    $('groupRankTab').classList.toggle('active', type === 'groups');
    $('callRankTab').classList.toggle('active', type === 'calls');
    renderRankings();
}

function loadRankings() {
    Promise.all([
        fetch(SERVER + '/api/ranking/groups').then(function(r) { return r.json(); }),
        fetch(SERVER + '/api/ranking/calls').then(function(r) { return r.json(); })
    ]).then(function(results) {
        groupRankings = results[0].code === 200 ? results[0].data : [];
        callRankings = results[1].code === 200 ? results[1].data : [];
        renderRankings();
    }).catch(function(e) { console.error('加载排行榜失败', e); });
}

function renderRankings() {
    var container = $('rankingList');
    var list = currentRankingType === 'groups' ? groupRankings : callRankings;
    
    if (!list || !list.length) {
        container.innerHTML = '<div class="ranking-empty"><div class="icon">📊</div><div>暂无排行数据</div></div>';
        return;
    }
    
    container.innerHTML = '';
    
    list.forEach(function(item, i) {
        var div = document.createElement('div');
        div.className = 'ranking-item';
        
        var rankClass = i === 0 ? 'gold' : (i === 1 ? 'silver' : (i === 2 ? 'bronze' : ''));
        var rankText = i < 3 ? ['🥇', '🥈', '🥉'][i] : '#' + (i + 1);
        
        if (currentRankingType === 'groups') {
            var displayName = data.groupRemarks[item.groupId] || item.groupName || item.groupId;
            div.innerHTML = 
                '<div class="rank-num ' + rankClass + '">' + rankText + '</div>' +
                '<div class="rank-info"><div class="rank-name">' + displayName + '</div>' +
                '<div class="rank-detail">' + item.totalCalls + ' calls · ' + item.wins + '/' + item.uniqueContracts + ' wins</div></div>' +
                '<div class="rank-stat"><div class="rank-value">' + parseFloat(item.winRate).toFixed(1) + '%</div><div class="rank-label">胜率</div></div>';
            div.addEventListener('click', function() { openGroupDetail(item.groupId, item.groupName); });
        } else {
            var isFollowed = !!data.special[item.userId];
            var nick = data.userRemarks[item.userId] || item.userNick || (item.userId || '').slice(0, 10);
            var groupName = data.groupRemarks[item.groupId] || item.groupName || '';
            var tokenDisplay = item.tokenSymbol || (item.address || '').slice(0, 8);
            var maxMult = parseFloat(item.maxMultiplier) || 1;
            var currMult = parseFloat(item.currentMultiplier) || 1;
            var maxColor = maxMult >= 2 ? '#00d4aa' : (maxMult >= 1 ? '#888' : '#f44');
            var currColor = currMult >= 2 ? '#00d4aa' : (currMult >= 1 ? '#888' : '#f44');
            div.innerHTML = 
                '<div class="rank-num ' + rankClass + '">' + rankText + '</div>' +
                '<div class="rank-info"><div class="rank-name">' + tokenDisplay + '</div>' +
                '<div class="rank-detail"><span class="call-user">' + (isFollowed ? '⭐ ' : '') + nick + '</span><span class="call-group">' + groupName + '</span></div></div>' +
                '<div class="rank-stat">' +
                '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">' +
                '<div style="display:flex;align-items:center;gap:3px">' +
                '<span style="font-size:8px;color:#666">最高</span>' +
                '<span class="rank-value" style="font-size:14px;color:' + maxColor + '">x' + maxMult.toFixed(2) + '</span>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:3px">' +
                '<span style="font-size:8px;color:#666">当前</span>' +
                '<span style="font-size:11px;font-weight:600;color:' + currColor + '">x' + currMult.toFixed(2) + '</span>' +
                '</div>' +
                '</div></div>' +
                '<button class="rank-follow-btn ' + (isFollowed ? 'followed' : '') + '">' + (isFollowed ? '已关注' : '关注') + '</button>';
            
            div.querySelector('.call-user').addEventListener('click', function(e) {
                e.stopPropagation();
                openUser(item.userId, item.userNick);
            });
            div.querySelector('.rank-follow-btn').addEventListener('click', function(e) {
                e.stopPropagation();
                toggleRankFollow(item.userId, item.userNick);
            });
        }
        
        container.appendChild(div);
    });
}

function toggleRankFollow(userId, userNick) {
    if (data.special[userId]) {
        delete data.special[userId];
        toast('已取消关注', 'success');
    } else {
        data.special[userId] = true;
        toast('已关注', 'success');
    }
    saveData();
    renderRankings();
}

function openGroupDetail(groupId, groupName) {
    $('groupDetailTitle').textContent = data.groupRemarks[groupId] || groupName || groupId;
    $('groupDetailList').innerHTML = '<div style="text-align:center;padding:20px;color:#666">加载中...</div>';
    $('groupDetailModal').classList.add('active');
    
    fetch(SERVER + '/api/ranking/group/' + encodeURIComponent(groupId) + '/contracts')
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.code === 200 && d.data && d.data.length > 0) {
                $('groupDetailList').innerHTML = d.data.map(function(c) {
                    var isFollowed = !!data.special[c.userId];
                    var nick = data.userRemarks[c.userId] || c.userNick || (c.userId || '').slice(0, 10);
                    var mc = formatMC(c.marketCap);
                    return '<div class="group-detail-item">' +
                        '<div class="group-detail-token">' +
                        '<span class="token-symbol">' + (c.tokenSymbol || (c.address || '').slice(0, 8)) + '</span>' +
                        '<span class="chain-badge ' + (c.type || '').toLowerCase() + '">' + (c.chain || c.type) + '</span>' +
                        '<span class="mc-info">' + mc + '</span></div>' +
                        '<div class="group-detail-user">' + (isFollowed ? '⭐ ' : '') + nick + '</div></div>';
                }).join('');
            } else {
                $('groupDetailList').innerHTML = '<div style="text-align:center;padding:20px;color:#666">暂无合约</div>';
            }
        })
        .catch(function() {
            $('groupDetailList').innerHTML = '<div style="text-align:center;padding:20px;color:#f44">加载失败</div>';
        });
}

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', function() {
    loadData();
    updateLabels();
    $('platformText').textContent = (data.platform || 'gmgn').toUpperCase();
    
    $('notifyBtn').addEventListener('click', testNotify);
    $('settingsBtn').addEventListener('click', openSettings);
    
    $('contractsViewTab').addEventListener('click', function() { switchView('contracts'); });
    $('rankingViewTab').addEventListener('click', function() { switchView('ranking'); });
    $('groupRankTab').addEventListener('click', function() { switchRankingType('groups'); });
    $('callRankTab').addEventListener('click', function() { switchRankingType('calls'); });
    
    document.querySelectorAll('.mc-filter-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            setMcFilter(btn.getAttribute('data-mc'));
        });
    });
    
    $('chainDropdownBtn').addEventListener('click', function() { toggleDropdown('chain'); });
    $('platformDropdownBtn').addEventListener('click', function() { toggleDropdown('platform'); });
    
    document.querySelectorAll('#chainDropdown .dropdown-item').forEach(function(item) {
        item.addEventListener('click', function() {
            selectChain(item.getAttribute('data-value'));
        });
    });
    
    document.querySelectorAll('#platformDropdown .dropdown-item').forEach(function(item) {
        item.addEventListener('click', function() {
            selectPlatform(item.getAttribute('data-value'));
        });
    });
    
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.dropdown-wrapper')) {
            closeAllDropdowns();
        }
    });
    
    $('settingsSaveBtn').addEventListener('click', saveSettings);
    $('settingsCancelBtn').addEventListener('click', closeSettings);
    $('groupManagerBtn').addEventListener('click', openGroupManager);
    $('blockManagerBtn').addEventListener('click', openBlockManager);
    
    $('userSaveBtn').addEventListener('click', saveUser);
    $('userCancelBtn').addEventListener('click', function() { closeModal('userModal'); });
    
    $('groupRemarkSaveBtn').addEventListener('click', saveGroupRemark);
    $('groupRemarkCancelBtn').addEventListener('click', function() { closeModal('groupRemarkModal'); });
    
    $('groupCloseBtn').addEventListener('click', function() { closeModal('groupModal'); });
    $('blockCloseBtn').addEventListener('click', function() { closeModal('blockModal'); });
    $('groupDetailCloseBtn').addEventListener('click', function() { closeModal('groupDetailModal'); });
    
    document.querySelectorAll('.modal').forEach(function(m) {
        m.addEventListener('click', function(e) {
            if (e.target === m) m.classList.remove('active');
        });
    });
    
    document.body.addEventListener('click', initAudio, { once: true });
    
    loadGroups();
    loadContracts();
    connectSSE();
});