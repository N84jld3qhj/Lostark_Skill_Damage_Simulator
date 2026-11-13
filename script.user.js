// ==UserScript==
// @name         로펙 시뮬레이터 베이스 스킬 데미지 시뮬레이터
// @namespace    https://github.com/N84jld3qhj/Lostark_WindWielder_Simulator
// @version      1.2.0
// @description  로펙 시뮬레이터 DOM 데이터를 읽어와 실시간으로 입력된 세팅을 기준으로 스킬 데미지 시뮬레이션을 제공합니다.
// @author       N84jld3qhj
// @match        https://lopec.kr/character/simulator/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=lopec.kr
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://raw.githubusercontent.com/N84jld3qhj/Lostark_WindWielder_Simulator/main/script.user.js
// @downloadURL  https://raw.githubusercontent.com/N84jld3qhj/Lostark_WindWielder_Simulator/main/script.user.js
// ==/UserScript==

(function () {
    'use strict';
    GM_addStyle(`
        /* 1. 팝업/모달 외곽 창 크기 대폭 확장 */
        #arkEvolutionContainer {
            display: flex !important;
            flex-direction: column !important;
            gap: 24px !important;
            width: 100% !important;
            padding: 20px !important;
            box-sizing: border-box !important;
        }

        .ark-row {
            display: grid !important;
            grid-template-columns: repeat(6, 1fr) !important;
            justify-items: center !important;
            align-items: center !important;
            width: 100% !important;
            gap: 12px !important;
        }

        .ark-node {
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            width: auto !important;
        }

        .ark-icon {
            width: 48px !important;
            height: 48px !important;
            border-radius: 50% !important;
            object-fit: cover !important;
            margin-bottom: 6px !important;
            cursor: pointer !important;
        }

        .ark-icon.grayscale {
            filter: grayscale(100%) opacity(0.35) !important;
        }

        .node-controls {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            background-color: #1e1b2e !important;
            border-radius: 6px !important;
            padding: 2px 6px !important;
            width: 85px !important;
        }

        .node-controls span {
            font-size: 12px !important;
            color: #e2e8f0 !important;
            font-family: monospace !important;
        }

        .btn-node {
            background: transparent !important;
            border: none !important;
            color: #8b5cf6 !important;
            font-size: 14px !important;
            font-weight: bold !important;
            cursor: pointer !important;
        }

        #arkEvolutionContainer,
        #arkEvolutionContainer * {
            box-sizing: border-box !important;
        }

        #arkEvolutionContainer {
            display: flex !important;
            flex-direction: column !important;
            gap: 20px !important;
            width: 100% !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            padding: 10px 0 !important;
        }

        .ark-row {
            display: grid !important;
            grid-template-columns: repeat(6, 1fr) !important;
            justify-items: center !important;
            align-items: center !important;
            width: 100% !important;
            gap: 8px !important;
        }
            table {
            table-layout: fixed;
            width: 100%;
        }
            td, th {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        `);

    // baselineResults 변수 선언 시 로컬 스토리지 데이터 복원
    let baselineResults = null;



    // =========================================================================
    // 게임 데이터 외부화: 코드 내 기본값 + JSON 덮어쓰기(GM 저장소 'GAME_DATA_OVERRIDE')
    //  - 각 표는 기본값을 코드에 두고, 저장소에 같은 이름의 데이터가 있으면 제자리에서 교체한다.
    //  - 덮어쓴 JSON이 깨졌거나 형태(배열/객체)가 다르면 기본값을 그대로 쓴다.
    // =========================================================================
    const GAME_DATA_TABLES = {};
    const GAME_DATA_DEFAULTS = {};
    const GAME_DATA_OVERRIDE = (() => {
        try { const v = GM_getValue('GAME_DATA_OVERRIDE', {}); return (v && typeof v === 'object') ? v : {}; }
        catch (e) { return {}; }
    })();
    function registerGameData(name, target) {
        GAME_DATA_TABLES[name] = target;
        GAME_DATA_DEFAULTS[name] = JSON.parse(JSON.stringify(target));
        const src = GAME_DATA_OVERRIDE[name];
        if (src === undefined || src === null) return;
        if (Array.isArray(target) !== Array.isArray(src) || typeof src !== 'object') {
            console.warn(`[게임 데이터] '${name}' 형태가 달라 기본값을 사용합니다.`);
            return;
        }
        const copy = JSON.parse(JSON.stringify(src));
        if (Array.isArray(target)) { target.length = 0; target.push(...copy); }
        else { Object.keys(target).forEach(k => delete target[k]); Object.assign(target, copy); }
    }

    const DEFAULT_ADD_STAT_BASE = []; // 데이터는 JSON 업로드(데이터 설정 > 5. 게임 데이터)로 채워진다
    registerGameData('DEFAULT_ADD_STAT_BASE', DEFAULT_ADD_STAT_BASE);

    // 1. 저장소 데이터 로드 및 방어 로직 (배열/객체 유효성 검사 보완)
    let skillDatabase = GM_getValue('skillDatabase');
    if (!skillDatabase || Object.keys(skillDatabase).length === 0) {
        skillDatabase = JSON.parse(JSON.stringify(typeof DEFAULT_SKILL_DATABASE !== 'undefined' ? DEFAULT_SKILL_DATABASE : {}));
    }

    let orderDataSets = GM_getValue('orderDataSets');
    if (!orderDataSets || Object.keys(orderDataSets).length === 0) {
        orderDataSets = JSON.parse(JSON.stringify(typeof DEFAULT_ORDER_DATA_SETS !== 'undefined' ? DEFAULT_ORDER_DATA_SETS : {}));
    }

    // 스토리지에서 불러오기
    let specializationCustom = GM_getValue('SPECIALIZATION_CUSTOM', null);
    let specializationDatabase = GM_getValue('specializationDatabase', null);

    // 유효성 검사 (배열과 객체 모두 체크)
    const isSpecValid = (data) => {
        if (!data) return false;
        if (Array.isArray(data)) return data.length > 0;
        return typeof data === 'object' && Object.keys(data).length > 0;
    };

    if (isSpecValid(specializationCustom)) {
        specializationDatabase = specializationCustom;
    } else if (!isSpecValid(specializationDatabase)) {
        specializationDatabase = JSON.parse(JSON.stringify(typeof DEFAULT_SPECIALIZATION_DATABASE !== 'undefined' ? DEFAULT_SPECIALIZATION_DATABASE : {}));
    }

    window.specializationDatabase = specializationDatabase;
    window.SPECIALIZATION_CUSTOM = specializationCustom;

    // 2. DEFAULT_ADD_STAT_BASE 기본 배열 변환
    let baseArray = [];
    if (Array.isArray(DEFAULT_ADD_STAT_BASE)) {
        baseArray = JSON.parse(JSON.stringify(DEFAULT_ADD_STAT_BASE));
    } else if (DEFAULT_ADD_STAT_BASE && typeof DEFAULT_ADD_STAT_BASE === 'object') {
        baseArray = Object.values(DEFAULT_ADD_STAT_BASE).map(item => ({
            name: item.name || '',
            effects: [{
                category: item.category || '',
                val: item.value !== undefined ? item.value : (item.val || 0),
                unit: item.unit || ''
            }]
        }));
    }

    // 3. 저장소에서 커스텀 데이터 불러오기 및 배열 검증
    let customStatData = GM_getValue('ADD_STAT_BASE_CUSTOM', []);
    if (!Array.isArray(customStatData)) {
        if (customStatData && typeof customStatData === 'object') {
            customStatData = Object.values(customStatData);
        } else {
            customStatData = [];
        }
    }

    // 4. 기본 데이터와 이름이 중복되는 데이터 제거 후 병합
    const baseNames = new Set(baseArray.map(item => item.name));
    const pureCustomData = customStatData.filter(item => item && item.name && !baseNames.has(item.name));

    let ADD_STAT_BASE = [...baseArray, ...pureCustomData];

    // window 전역 객체와 동기화
    window.skillDatabase = skillDatabase;
    window.orderDataSets = orderDataSets;
    window.specializationDatabase = specializationDatabase; // 👈 이제 배열 형태 특화 데이터도 정상 유지됨
    window.ADD_STAT_BASE = ADD_STAT_BASE;

    window.ADD_STAT_BASE_CUSTOM = pureCustomData;
    window.SPECIALIZATION_CUSTOM = specializationCustom || {};

    try {
        const savedData = localStorage.getItem('savedBaselineResults');
        if (savedData) {
            baselineResults = JSON.parse(savedData);
        }
    } catch (e) {
        console.error('로컬스토리지 불러오기 실패:', e);
        baselineResults = null;
    }

    // 전역 변수 선언
    let lastCalculatedResults = null; // 최근 계산 결과

    window.isCalcPaused = true;


    // =============================================================================
    // 1. 아크 패시브 진화 노드 데이터셋 및 라인별 제한
    // =============================================================================
    const rowMaxLimits = [40, 3, 2, 2, 2];

    const evolutionNodes = []; // 데이터는 JSON 업로드(데이터 설정 > 5. 게임 데이터)로 채워진다
    registerGameData('evolutionNodes', evolutionNodes);

    const SAVE_KEY = "arkPassiveSetting_v1";
    loadArkPassive();

    function saveArkPassive() {
        const data = evolutionNodes.map(row =>
            row.map(node => node.current)
        );
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    }

    function loadArkPassive() {
        const saved = localStorage.getItem(SAVE_KEY);
        if (!saved) return;

        const data = JSON.parse(saved);

        evolutionNodes.forEach((row, i) => {
            row.forEach((node, j) => {
                if (data[i] && data[i][j] !== undefined) {
                    node.current = data[i][j];
                }
            });
        });
    }


    // =============================================================================
    // 2. 상수 및 테이블 정의
    // =============================================================================

    // 상수 테이블
    const SLOT_KO = { sun: '해', moon: '달', star: '별' };

    const STAT_CONSTANTS = {}; // 데이터는 JSON 업로드(데이터 설정 > 5. 게임 데이터)로 채워진다
    registerGameData('STAT_CONSTANTS', STAT_CONSTANTS);


    // 장비 강화 테이블
    const equipmentDataset = {}; // 데이터는 JSON 업로드(데이터 설정 > 5. 게임 데이터)로 채워진다
    registerGameData('equipmentDataset', equipmentDataset);

    // 보석 테이블
    const gemDataTable = {}; // 데이터는 JSON 업로드(데이터 설정 > 5. 게임 데이터)로 채워진다
    registerGameData('gemDataTable', gemDataTable);

    // 각인 테이블
    const engravingTable = {}; // 데이터는 JSON 업로드(데이터 설정 > 5. 게임 데이터)로 채워진다
    registerGameData('engravingTable', engravingTable);


    const coreLevels = [10, 14, 17, 18, 19, 20];

    // 혼돈 코어 테이블
    const chaosDataSets = {}; // 데이터는 JSON 업로드(데이터 설정 > 5. 게임 데이터)로 채워진다
    registerGameData('chaosDataSets', chaosDataSets);

    // 팔찌 테이블
    const braceletTable = {}; // 데이터는 JSON 업로드(데이터 설정 > 5. 게임 데이터)로 채워진다
    registerGameData('braceletTable', braceletTable);

    // 장신구 연마 옵션 테이블
    const accessoryTable = {}; // 데이터는 JSON 업로드(데이터 설정 > 5. 게임 데이터)로 채워진다
    registerGameData('accessoryTable', accessoryTable);



    // =============================================================================
    // 3. 헬퍼 함수 정의
    // =============================================================================


    // 팔찌 옵션 파싱
    function getBraceletOptionData(rawOpt, grade) {
        if (!rawOpt || rawOpt === '없음' || rawOpt === 'none') return [];

        const cleanTarget = rawOpt
            .replace(/[\d\.\+%]+/g, '')
            .replace(/\s+/g, '');

        for (const [key, effects] of Object.entries(braceletTable)) {
            const cleanKey = key.replace(/\s+/g, '');

            if (cleanTarget.includes(cleanKey) || cleanKey.includes(cleanTarget)) {
                return effects.map(eff => {
                    const val = eff.values[grade] ?? eff.values['중'] ?? 0;
                    return {
                        category: eff.category,
                        val: val,
                        unit: eff.unit || "%",
                        requireTags: eff.requireTags || []
                    };
                }).filter(eff => eff.val !== 0);
            }
        }
        return [];
    }

    // 스탯 입력 함수
    function addStat(statsObj, category, source, val, unit = "%") {
        if (!statsObj[category]) statsObj[category] = [];
        if (val !== 0 && val !== undefined && val !== null) {
            statsObj[category].push({ source, val, unit });
        }
    }

    // 스탯 합
    function getStatSum(statsObj, category) {
        if (!statsObj[category] || !Array.isArray(statsObj[category])) return 0;
        return statsObj[category].reduce((sum, item) => sum + (Number(item.val) || 0), 0);
    }

    /**
     * 특정 카테고리의 스탯들을 곱연산(곱적용)하여 최종 배율을 반환하는 함수
     * @param {Object} statsObj - 스탯 객체 (예: stats)
     * @param {string} category - 카테고리 이름 (예: "적에게 주는 피해")
     * @param {boolean} isPercentage - val 값이 퍼센트 값(2.5 = 2.5%)이면 true, 이미 배율(1.025)이면 false (기본값: true)
     * @returns {number} 최종 곱연산 배율 (데이터가 없거나 비어있으면 1.0 반환)
     */
    function getStatProduct(statsObj, category, isPercentage = true) {
        if (!statsObj[category] || !Array.isArray(statsObj[category])) return 1.0;

        return statsObj[category].reduce((acc, item) => {
            const rawVal = Number(item.val) || 0;

            // 퍼센트(%) 형태(예: 5 -> 1.05)인지, 이미 배율 형태(예: 1.05)인지 판별하여 곱함
            const multiplier = isPercentage ? (1 + rawVal / 100) : rawVal;

            return acc * multiplier;
        }, 1.0);
    }

    // 방여럭 계수 계산 함수
    function getDefPenMultiplier(statsObj) {
        if (!statsObj["방어력 무시"] || !Array.isArray(statsObj["방어력 무시"])) return 0;

        // 잔여 방어력 비율을 구한 뒤 (1 - 잔여 비율)로 총 관통률(0.0 ~ 1.0) 계산
        const remainingRate = statsObj["방어력 무시"].reduce((acc, item) => {
            const val = Number(item.val) || 0;
            return acc * (1 - (val / 100));
        }, 1.0);

        return 1 - remainingRate;
    }

    // 기본 데미지 계산 함수
    function calculateDamageBase(atk, coefficient, constant,defPenMultiplier) {
        const defenseRatio = 6500 / (6500 + 6500*(1-defPenMultiplier));
        return (coefficient * atk + constant) * 0.76 * defenseRatio;
    }


    // 아크 패시브 스탯 파싱 함수
    function getArkEvolutionStats() {
        let arkStats = {};

        evolutionNodes.forEach((row, rowIndex) => {
            const tierName = `${rowIndex + 1}티어`;

            row.forEach((node) => {
                const nodeLevel = node.current || node.level || 0;
                if (nodeLevel <= 0) return;

                // 상위 노드 태그 추출
                const nodeReqTags = node.requireTags || node.requireSkillTags || [];
                const nodeExTags = node.excludeTags || node.excludeSkillTags || [];

                if (node.effects && node.effects.length > 0) {
                    node.effects.forEach(eff => {
                        // 하위 이펙트 태그 추출
                        const effReqTags = eff.requireTags || eff.requireSkillTags || eff.targetTags || [];
                        const effExTags = eff.excludeTags || eff.excludeSkillTags || [];

                        // 태그 병합 (중복 제거)
                        const mergedReqTags = [...new Set([...nodeReqTags, ...effReqTags])];
                        const mergedExTags = [...new Set([...nodeExTags, ...effExTags])];

                        const catName = eff.type || eff.category;
                        const valPerLvl = eff.valuePerLevel || eff.val || 0;
                        const calculatedVal = parseFloat((nodeLevel * valPerLvl).toFixed(2));

                        if (calculatedVal === 0 && !catName) return;

                        // 🌟 [핵심 복원] 스탯성 데이터(치/신/특) 단위 구분 로직
                        const isRawStat = ["치명", "신속", "특화", "제압", "인내", "숙련"].includes(catName);
                        const unitStr = eff.unit !== undefined ? eff.unit : (isRawStat ? "" : "%");

                        // 출처 텍스트 (max 존재 여부에 따른 유연한 표기)
                        const sourceText = node.max
                            ? `아크 패시브(진화 ${tierName}): ${node.name} [${nodeLevel}/${node.max}LV]`
                            : `아크 패시브(진화 ${tierName}): ${node.name} [Lv.${nodeLevel}]`;

                        if (!arkStats[catName]) arkStats[catName] = [];
                        arkStats[catName].push({
                            source: sourceText,
                            val: calculatedVal,
                            unit: unitStr,
                            requireTags: mergedReqTags,
                            excludeTags: mergedExTags
                        });
                    });
                }
            });
        });

        return arkStats;
    }


    // =============================================================================
    // 4. DOM 파싱 및 데이터 정제
    // =============================================================================

    // 전체 파싱
    // =============================================================================
    // 로펙 시뮬레이터 DOM 셀렉터 모음 (사이트 개편 시 이 객체만 수정하면 됨)
    // =============================================================================
    const SEL = {
        // 공통
        labelText: 'span[class*="BaseSelect_labelText"]',       // select 옆에 표시되는 선택값 텍스트
        qualityBarTestId: 'div[data-testid="quality-bar"]',
        qualityBarClass: 'div[class*="QualityBar_qualityBar"]',
        tierLabel: 'span[class*="ChaTierLabel"]',                // 상/중/하 라벨
        optionButton: 'button[id*="-option-select-"]',           // OptionPicker 버튼 (title에 옵션 문구)

        engraving: {
            stoneWrap: 'div[class*="SimGroupAccessory_stoneWrap"]',
            box: 'div[class*="SimGroupEngraving_engravingBox"]',
            optionSelect: 'select[id*="engraving-option"]',
            levelSelect: 'select[id*="engraving-level"]'
        },
        accessory: {
            wrap: 'div[class*="SimGroupAccessory_accessoryWrap"]',
            statInput: 'input[class*="SimGroupAccessory_input"]',
            optionItem: 'div[class*="SimGroupAccessory_optionItem"]'
        },
        arkGem: {
            list: '[role="list"][aria-label="옵션별 실 효율 목록"]',
            item: '[role="listitem"]',
            name: '[class*="DetailSpec_name"]',
            value: '[class*="DetailSpec_value"]',
            invalidMark: '비유효'                                  // item의 aria-label에 포함되면 무효 옵션
        },
        combatGem: {
            box: 'div[class*="SimGroupGem_gemBox"]',
            typeSelect: 'select[id*="gem-type"]',
            levelSelect: 'select[id*="gem-level"]',
            skillSelect: 'select[id*="gem-skill"]'
        },
        arkCore: {
            gradeSelect: (i) => `select#ark-core-${i}`,          // 0~2 질서(해/달/별), 3~5 혼돈(해/달/별)
            bladeSelect: (i) => `select#ark-blade-${i}`,
            card: 'article',
            point: '[aria-label="코어 포인트"]'
        },
        bracelet: {
            wrap: 'div[class*="SimGroupAccessory_bangleWrap"]',
            stat: 'div[class*="SimGroupAccessory_bangleStat"]',
            optionItem: 'div[class*="SimGroupAccessory_bangleOptionItem"]'
        },
        armory: {
            box: 'div[class*="SimGroupArmory_armoryBox"]',
            normalSelect: 'select[id*="-normal"]',
            tierSelect: 'select[id*="-tier"]',
            ellaSelect: 'select[id*="-esther-ella"]'
        },
        arkPassive: {
            wrap: 'div[class*="SimGroupArkPassive_arkPassiveWrap"]',
            tagText: '[class*="ChaBaseTag_tagText"]',
            point: 'span[class*="SimGroupArkPassive_point"]',
            rankButton: 'button[aria-pressed="true"]',
            levelInput: 'div[class*="SimGroupArkPassive_levelBox"] input'
        }
    };

    // 파서 자가 진단: 영역별로 한 번만 경고 (정상으로 돌아오면 다시 경고 가능)
    const parseWarned = new Set();
    function reportParse(area, ok, hint) {
        if (ok) { parseWarned.delete(area); return; }
        if (parseWarned.has(area)) return;
        parseWarned.add(area);
        console.warn(`[파서 진단] ${area}: ${hint} → 사이트 개편으로 SEL.${area} 셀렉터가 바뀌었는지 확인하세요.`);
    }

    function extractFullSimulatorData(doc = document) {
        // select 옆 라벨 텍스트 (없으면 null)
        const labelOf = (selectEl) => selectEl?.parentElement?.querySelector(SEL.labelText)?.textContent.trim() ?? null;
        const qualityBarOf = (box) => box.querySelector(SEL.qualityBarTestId) || box.querySelector(SEL.qualityBarClass);
        const gradeFromLabel = (el) => {
            const text = el?.textContent.trim() || '';
            if (text.includes('상')) return '상';
            if (text.includes('하')) return '하';
            return '중';
        };

        const cleanOptionName = (rawText) => {
            if (!rawText || rawText === '없음') return null;
            return rawText.replace(/\+?\s*\d+(\.\d+)?/g, '').replace(/\s+/g, ' ').trim() || rawText;
        };
        // 개편 후: OptionPicker 버튼의 title / 구버전: BaseSelect 라벨 (호환용 폴백)
        const readOptionText = (item) => {
            const btn = item.querySelector(SEL.optionButton);
            const text = btn?.getAttribute('title') || btn?.textContent;
            if (text && text.trim()) return text.trim();
            return item.querySelector(SEL.labelText)?.textContent.trim() || '';
        };

        const parseEngravings = () => {
            const stoneLevels = {};
            const stoneWrap = doc.querySelector(SEL.engraving.stoneWrap);
            if (stoneWrap) {
                stoneWrap.querySelectorAll('select').forEach(selectEl => {
                    const text = labelOf(selectEl) || '';
                    const match = text.match(/^(.*?)\s+Lv\.(\d+)$/);
                    if (match) stoneLevels[match[1].trim()] = `${match[2]}LV`;
                });
            }
            const engravings = [];
            const boxes = doc.querySelectorAll(SEL.engraving.box);
            reportParse('engraving', boxes.length > 0, '각인 박스를 찾지 못함');
            boxes.forEach(box => {
                const name = labelOf(box.querySelector(SEL.engraving.optionSelect)) ?? '없음';
                if (name && name !== '없음') {
                    const rawLevel = labelOf(box.querySelector(SEL.engraving.levelSelect)) ?? '0';
                    const levelNum = parseInt(rawLevel.replace(/[^0-9]/g, ''), 10) || 0;
                    engravings.push({ name, level: `${levelNum}LV`, stone: stoneLevels[name] || '0LV' });
                }
            });
            return engravings;
        };

        const parseAccessories = () => {
            const accessories = [];
            const accWraps = doc.querySelectorAll(SEL.accessory.wrap);
            reportParse('accessory', accWraps.length > 0, '장신구 래퍼를 찾지 못함');
            let earringCount = 1, ringCount = 1;
            let itemCount = 0, readCount = 0;

            accWraps.forEach((wrap, index) => {
                let name = '';
                let idsString = '';
                wrap.querySelectorAll('select').forEach(s => idsString += (s.id || '') + ' ');
                const lowerIds = idsString.toLowerCase();
                const wrapText = wrap.textContent || '';

                if (lowerIds.includes('necklace') || wrapText.includes('목걸이')) name = '목걸이';
                else if (lowerIds.includes('earing') || lowerIds.includes('earring') || wrapText.includes('귀걸이')) name = `귀걸이 ${earringCount++}`;
                else if (lowerIds.includes('ring') || wrapText.includes('반지')) name = `반지 ${ringCount++}`;
                else {
                    if (index === 0) name = '목걸이';
                    else if (index === 1 || index === 2) name = `귀걸이 ${earringCount++}`;
                    else name = `반지 ${ringCount++}`;
                }

                const statInput = wrap.querySelector(SEL.accessory.statInput);
                const statValue = statInput ? (parseInt(statInput.value, 10) || 0) : 0;

                const slots = [];
                wrap.querySelectorAll(SEL.accessory.optionItem).forEach(item => {
                    itemCount++;
                    const grade = gradeFromLabel(item.querySelector(SEL.tierLabel));
                    const rawText = readOptionText(item);
                    if (rawText) readCount++;
                    const optName = cleanOptionName(rawText);
                    if (optName) slots.push({ opt: optName, grade });
                });

                accessories.push({ name, statValue, slots });
            });
            reportParse('accessory.optionItem', itemCount === 0 || readCount > 0, '옵션 슬롯은 있으나 옵션 문구를 읽지 못함');
            return accessories;
        };

        const parseArkGems = () => {
            const gems = { atk: 0, addDmg: 0, bossDmg: 0 };
            const list = doc.querySelector(SEL.arkGem.list);
            reportParse('arkGem', !!list, '옵션별 실 효율 목록을 찾지 못함');
            if (!list) return gems;

            list.querySelectorAll(SEL.arkGem.item).forEach(item => {
                if ((item.getAttribute('aria-label') || '').includes(SEL.arkGem.invalidMark)) return;

                const rawName = item.querySelector(SEL.arkGem.name)?.textContent || '';
                const name = rawName.replace(/Lv\.\s*\d+/, '').trim();   // "공격력 Lv.53" -> "공격력"
                const rawVal = item.querySelector(SEL.arkGem.value)?.textContent || '0';
                const val = parseFloat(rawVal.replace(/[^0-9.\-]/g, '')) || 0;

                if (name === '공격력') gems.atk = val;
                else if (name === '추가 피해') gems.addDmg = val;
                else if (name === '보스 피해') gems.bossDmg = val;
            });
            return gems;
        };

        const parseCombatGems = () => {
            const gems = [];
            const boxes = doc.querySelectorAll(SEL.combatGem.box);
            reportParse('combatGem', boxes.length > 0, '전투 보석 박스를 찾지 못함');
            boxes.forEach(box => {
                const type = labelOf(box.querySelector(SEL.combatGem.typeSelect)) ?? '없음';
                const rawLevel = labelOf(box.querySelector(SEL.combatGem.levelSelect));
                const level = rawLevel ? rawLevel.replace(/[^0-9]/g, '') : '0';
                const skillName = labelOf(box.querySelector(SEL.combatGem.skillSelect)) ?? '없음';

                if (type !== '없음' && parseInt(level, 10) > 0) gems.push({ skillName, type, level });
            });
            return gems;
        };

        const parseArkCores = () => {
            const emptyCore = () => ({ name: '', grade: '미장착', level: 0 });
            const chaosCores = { Sun: emptyCore(), Moon: emptyCore(), Star: emptyCore() };
            const orderCores = { Sun: emptyCore(), Moon: emptyCore(), Star: emptyCore() };
            const slotKeys = ['Sun', 'Moon', 'Star'];
            let found = 0;

            // select의 표시 텍스트 (라벨 → 선택된 option → value 순으로 폴백)
            const readSelectText = (sel) => {
                if (!sel) return '';
                return labelOf(sel) || sel.options?.[sel.selectedIndex]?.textContent.trim() || sel.value || '';
            };

            for (let i = 0; i < 6; i++) {
                const gradeSel = doc.querySelector(SEL.arkCore.gradeSelect(i));
                if (!gradeSel) continue;
                found++;
                const bladeSel = doc.querySelector(SEL.arkCore.bladeSelect(i));
                const card = gradeSel.closest(SEL.arkCore.card);

                const grade = readSelectText(gradeSel) || '미장착';       // "고대 코어"
                const name = readSelectText(bladeSel);                      // "비연참" / "없음"
                const pointText = card?.querySelector(SEL.arkCore.point)?.textContent || '';
                const level = parseInt(pointText.replace(/[^0-9]/g, ''), 10) || 0;

                const equipped = name && name !== '없음';
                (i < 3 ? orderCores : chaosCores)[slotKeys[i % 3]] = equipped
                    ? { name, grade, level }
                    : emptyCore();
            }
            reportParse('arkCore', found > 0, '코어 select(ark-core-N)를 하나도 찾지 못함');
            return { chaosCores, orderCores };
        };

        const parseBracelet = () => {
            const bracelet = { options: [] };
            const bangleWrap = doc.querySelector(SEL.bracelet.wrap);
            reportParse('bracelet', !!bangleWrap, '팔찌 래퍼를 찾지 못함');
            if (!bangleWrap) return bracelet;

            const statKeyMap = {
                '치명': 'crit',
                '신속': 'swift',
                '특화': 'spec',
                '힘': 'mainStat',
                '민첩': 'mainStat',
                '지능': 'mainStat'
            };
            bangleWrap.querySelectorAll(SEL.bracelet.stat).forEach(itemEl => {
                const sel = itemEl.querySelector('select');
                const inp = itemEl.querySelector('input');
                if (sel && inp) {
                    const label = labelOf(sel);
                    const key = statKeyMap[label] || label;
                    const val = parseInt(inp.value, 10) || 0;
                    if (key && val > 0) bracelet[key] = val;
                }
            });

            let itemCount = 0, readCount = 0;
            bangleWrap.querySelectorAll(SEL.bracelet.optionItem).forEach(itemEl => {
                itemCount++;
                const grade = gradeFromLabel(itemEl.querySelector(SEL.tierLabel));
                const rawText = readOptionText(itemEl);
                if (rawText) readCount++;
                const optName = cleanOptionName(rawText);
                if (optName && optName !== '없음') {
                    bracelet.options.push({ opt: optName, grade });
                }
            });
            reportParse('bracelet.optionItem', itemCount === 0 || readCount > 0, '옵션 슬롯은 있으나 옵션 문구를 읽지 못함');

            return bracelet;
        };

        const parseEquipment = () => {
            const equipment = {};
            const boxes = doc.querySelectorAll(SEL.armory.box);
            reportParse('armory', boxes.length > 0, '장비 박스를 찾지 못함');
            boxes.forEach(box => {
                const normalSelect = box.querySelector(SEL.armory.normalSelect);
                if (!normalSelect) return;

                const part = normalSelect.id.replace('armory-', '').replace('-normal', '');
                const levelText = labelOf(normalSelect);
                if (levelText === null) return;

                const level = parseInt(levelText.replace(/[^0-9]/g, ''), 10) || 0;

                if (part === 'vambrace') {
                    // 완갑
                    const gradeEl = qualityBarOf(box);
                    equipment[part] = level;
                    equipment.vambraceGrade = gradeEl ? gradeEl.textContent.trim() : '일반';
                } else if (part === 'weapon') {
                    // 무기: 표시 텍스트 우선 (없으면 select value) -> '에스더', 'T4 전율' 등
                    const tierSelect = box.querySelector(SEL.armory.tierSelect);
                    const weaponTier = labelOf(tierSelect) || tierSelect?.value || '';
                    const isEsther = weaponTier.includes('에스더');
                    if (typeof window.updateEstherUI === 'function') window.updateEstherUI(isEsther);

                    // 에스더 엘라 단계 ("엘라 3" 또는 value "3" 에서 숫자만 추출)
                    let estherElla = 0;
                    if (isEsther) {
                        const ellaSelect = box.querySelector(SEL.armory.ellaSelect);
                        const rawElla = labelOf(ellaSelect) || ellaSelect?.value || '0';
                        estherElla = parseInt(rawElla.replace(/[^0-9]/g, ''), 10) || 0;
                    }

                    equipment[part] = level;
                    equipment.weaponTier = weaponTier;
                    equipment.isEsther = isEsther;
                    equipment.estherElla = estherElla;
                } else {
                    // 기타 방어구
                    equipment[part] = level;
                }
            });
            return equipment;
        };

        const parseArkPassives = () => {
            const arkPassive = {};
            const wrapElements = doc.querySelectorAll(SEL.arkPassive.wrap);
            reportParse('arkPassive', wrapElements.length > 0, '아크 패시브 래퍼를 찾지 못함');

            wrapElements.forEach(wrap => {
                const category = wrap.querySelector(SEL.arkPassive.tagText)?.textContent.trim() || null;
                if (!category) return;

                const pointEl = wrap.querySelector(SEL.arkPassive.point);
                const point = pointEl ? parseInt(pointEl.textContent.trim(), 10) || 0 : 0;

                const rankBtn = wrap.querySelector(SEL.arkPassive.rankButton);
                const rank = rankBtn ? parseInt(rankBtn.value || rankBtn.textContent.trim(), 10) || 0 : 0;

                const levelInput = wrap.querySelector(SEL.arkPassive.levelInput);
                const level = levelInput && levelInput.value ? parseInt(levelInput.value, 10) || 0 : 0;

                arkPassive[category] = { point, rank, level };
            });

            return arkPassive;
        };

        const { chaosCores, orderCores } = parseArkCores();

        return {
            engravings: parseEngravings(),
            accessories: parseAccessories(),
            gems: parseArkGems(),
            jewels: parseCombatGems(),
            chaosCores,
            orderCores,
            arkPassive: parseArkPassives(),
            bracelet: parseBracelet(),
            equipment: parseEquipment()
        };
    }

    // 파싱된 데이터를 입력 양식에 맞춰 정제
    function mapExtractedDataToInputs(extracted) {
        const eq = extracted.equipment || {};

        // 영문/한글 키 대응
        const headLvl     = eq.helmet    ?? eq.head    ?? eq["머리"]        ?? 0;
        const topLvl      = eq.armor     ?? eq.top     ?? eq["상의"]        ?? 0;
        const bottomLvl   = eq.pants     ?? eq.bottom  ?? eq["하의"]        ?? 0;
        const gloveLvl    = eq.gloves    ?? eq.glove   ?? eq["장갑"]        ?? 0;
        const shoulderLvl = eq.shoulder  ?? eq["어깨"] ?? eq["어깨 방어구"] ?? 0;
        const weaponLvl   = eq.weapon    ?? eq["무기"]                    ?? 0;
        const vambraceLvl = eq.vambrace  ?? eq['완갑']                    ?? 0;

        // 에스더 정보 파싱 확인
        const isEsther   = Boolean(eq.isEsther || (typeof eq.weaponTier === 'string' && eq.weaponTier.includes('에스더')));
        const estherElla = eq.estherElla ?? 0; // 숫자 0, 1, 2, 3

        // 1. 방어구 스탯 추출
        const headStat     = equipmentDataset["머리"]?.[headLvl] || 0;
        const topStat      = equipmentDataset["상의"]?.[topLvl] || 0;
        const bottomStat   = equipmentDataset["하의"]?.[bottomLvl] || 0;
        const gloveStat    = equipmentDataset["장갑"]?.[gloveLvl] || 0;
        const shoulderStat = equipmentDataset["어깨 방어구"]?.[shoulderLvl] || equipmentDataset["어깨"]?.[shoulderLvl] || 0;

        // 2. ★ [핵심] 무기 스탯 계산 (에스더 데이터셋 구조 적용)
        let weaponStat = 0;
        if (isEsther) {
            const ellaKey = `엘라 ${estherElla}`; // 예: "엘라 3", "엘라 2"
            weaponStat = equipmentDataset["에스더"]?.[ellaKey]?.[weaponLvl] || 0;
        } else {
            weaponStat = equipmentDataset["무기"]?.[weaponLvl] || 0;
        }

        // 3. 완갑 및 악세서리 계산
        const vambraceData = equipmentDataset["완갑"]?.[vambraceLvl] || { 무기공격력: 0, 주스탯: 0, 기본공격력: 0 };
        const accessoryBaseStat = (extracted.accessories || []).reduce((acc, currentAcc) => acc + (currentAcc.statValue || 0), 0);

        // 4. 스탯 총합
        const armorBaseStat = headStat + topStat + bottomStat + gloveStat + shoulderStat;
        const totalBaseStat = armorBaseStat + (vambraceData.지능 || vambraceData.주스탯 || 0) + accessoryBaseStat;

        return {
            baseStat: totalBaseStat,
            headStat: headStat,
            topStat: topStat,
            bottomStat: bottomStat,
            gloveStat: gloveStat,
            shoulderStat: shoulderStat,

            // 무기 관련
            weaponAtk: weaponStat,
            isEsther: isEsther,
            estherElla: estherElla,
            weaponTier: eq.weaponTier || '',

            vambraceGrade: eq.vambraceGrade ?? '영웅',
            vambraceData: vambraceData,
            partyCritCount: 0,
            engravings: extracted.engravings || [],
            accessories: extracted.accessories || [],
            gems: extracted.gems || { atk: 0, addDmg: 0, bossDmg: 0 },
            skillGems: extracted.jewels || [],
            chaosCores: extracted.chaosCores || {},
            orderCores: extracted.orderCores || {},
            bracelet: extracted.bracelet || { crit: 0, swift: 0, mainStat: 0, options: [] },
            arkPassive: extracted.arkPassive
        };
    }

    function transformToInputs(parsedData) {
        const rawStat = Number(parsedData.baseStat) || 0;
        const calculatedBaseStat = Math.floor(rawStat * 1.09);

        const formattedEngravings = (parsedData.engravings || []).map(eng => ({
            name: eng.name,
            level: eng.level,
            stone: eng.stone
        }));

        const gemsList = parsedData.skillGems || parsedData.jewels || [];
        const formattedSkillGems = gemsList.map(gem => ({
            skillName: gem.skillName,
            type: gem.type,
            level: Number(gem.level) || 0
        }));

        return {
            ...parsedData,
            baseStat: calculatedBaseStat,
            weaponAtk: Number(parsedData.weaponAtk) || 0,
            vambraceData: parsedData.vambraceData,
            engravings: formattedEngravings,
            skillGems: formattedSkillGems,
            gems: parsedData.gems || {},
            chaosCores: parsedData.chaosCores || {},
            orderCores: parsedData.orderCores || {},
            accessories: parsedData.accessories || [],
            bracelet: parsedData.bracelet || {},
            arkPassive: parsedData.arkPassive || {}
        };
    }


    // =============================================================================
    // 5. 핵심 스탯 및 데미지 연산 엔진
    //    - window 의존은 readEngineEnv()에서만 읽고, 이하 함수들은 env/inputs만 사용
    // =============================================================================

    // 연산에 필요한 window 전역 값을 한 곳에서 읽는다
    function readEngineEnv(inputs) {
        let specDB = window.specializationDatabase || {};
        if (specDB.specializationDatabase) specDB = specDB.specializationDatabase;

        return {
            statList: Array.isArray(window.ADD_STAT_BASE) ? window.ADD_STAT_BASE : Object.values(window.ADD_STAT_BASE || {}),
            partyCritCount: window.partyCritCount || 0,
            multiCrit: !!window.multiCritEnabled,
            estherBonding1: !!window.estherBonding1,
            estherBonding2: !!window.estherBonding2,
            orderDataSets: window.orderDataSets || {},
            chaosDataSets: window.chaosDataSets || chaosDataSets,
            specDB,
            selectedTripods: inputs?.selectedTripods || window.selectedSkillTripods || {}
        };
    }

    // ── 5-1. 태그 매칭 ─────────────────────────────────────────────────────────
    /**
     * 스킬 태그 조건 검사. ctx = { tags: string[], name: string }
     * - cond.exclude 중 하나라도 해당하면 false
     * - cond.require가 비어 있으면 true, 아니면 하나라도(opts.all=true면 전부) 해당해야 true
     * - opts.exName / opts.reqName: 제외/요구 조건에서 스킬명도 태그처럼 비교할지 (기본 true)
     */
    function matchTags(ctx, { require = [], exclude = [] } = {}, { all = false, exName = true, reqName = true } = {}) {
        const has = (t, byName) => ctx.tags.includes(t) || (byName && t === ctx.name);
        if (exclude.some(t => has(t, exName))) return false;
        if (require.length === 0) return true;
        return all ? require.every(t => has(t, reqName)) : require.some(t => has(t, reqName));
    }

    // 태그 추가/제거 효과 수집 (list: 호출마다 새로 만드는 배열)
    function addTagModifier(list, sourceName, effect) {
        const cat = effect.category || effect.type;
        if (cat !== "태그 추가" && cat !== "태그 제거") return;

        list.push({
            source: sourceName,
            action: cat === "태그 추가" ? "ADD" : "REMOVE",
            targetTag: String(effect.val).trim(),
            requireTags: effect.targetTags || effect.requireTags || effect.requireSkillTags || [],
            excludeTags: effect.excludeTags || effect.excludeSkillTags || []
        });
    }

    // ── 5-2. 질서/혼돈 코어 공통 유틸 ──────────────────────────────────────────
    const CORE_SLOTS = ['Sun', 'Moon', 'Star'];

    // 장착된 코어 정보 (미장착이면 null)
    function getEquippedCore(coresObj, slot) {
        const key = Object.keys(coresObj || {}).find(k => k.toLowerCase() === slot.toLowerCase());
        const info = (coresObj || {})[key];
        if (!info || !info.grade || info.grade === '미장착' || !info.level) return null;
        return { name: info.name, grade: info.grade, level: info.level, koreanSlot: SLOT_KO[slot.toLowerCase()] };
    }

    // 질서 코어 데이터 찾기 (이름/ID 정확 일치 -> 부분 일치)
    function findOrderCoreData(orderData, equippedName) {
        const cores = Object.values(orderData || {});
        let coreData = cores.find(c => c.name === equippedName || c.id === equippedName);
        if (!coreData && equippedName) {
            coreData = cores.find(c =>
                (c.name && (equippedName.includes(c.name) || c.name.includes(equippedName))) ||
                (c.id && (equippedName.includes(c.id) || c.id.includes(equippedName)))
            );
        }
        return coreData;
    }

    // 장착 등급에 맞는 등급 키 (loose: 등급 텍스트의 한글만 뽑아 역방향 부분 일치까지 허용)
    function findGradeKey(gradesObj, grade, loose) {
        return Object.keys(gradesObj).find(k =>
            k === grade || grade.includes(k) || (loose && k.includes(grade.replace(/[^가-힣]/g, '')))
        );
    }

    // 질서 코어 등급 데이터의 (필요 포인트 <= 레벨) 효과들을 순회
    function forEachCoreEffect(gradeContent, userLevel, cb) {
        const pointsObj = gradeContent.points || gradeContent;
        if (!pointsObj || typeof pointsObj !== 'object') return;

        Object.entries(pointsObj).forEach(([reqPointStr, pointData]) => {
            const reqPoint = Number(reqPointStr);
            if (!(userLevel >= reqPoint)) return;

            const nodeList = pointData.nodes || (Array.isArray(pointData) ? pointData : [pointData]);
            nodeList.forEach(nodeItem => {
                const targetEffects = Array.isArray(nodeItem.effects) ? nodeItem.effects : [nodeItem];
                targetEffects.forEach(effect => cb(effect, reqPoint));
            });
        });
    }

    // 코어 효과가 이 스킬에 적용되는지 (emptyTagsIsGlobal: 빈 태그 배열도 전체 적용으로 볼지)
    function matchCoreEffect(effect, ctx, emptyTagsIsGlobal) {
        const { skills, requireTags, tags: targetTags, excludeTags, excludeSkillTags } = effect;
        const exTags = excludeTags || excludeSkillTags || [];
        if (exTags.some(t => ctx.tags.includes(t) || t === ctx.name)) return false;

        const effectiveTags = requireTags || targetTags;
        const isSkillMatch = Array.isArray(skills) && skills.includes(ctx.name);
        const isTagMatch = Array.isArray(effectiveTags) && effectiveTags.some(t => ctx.tags.includes(t) || t === ctx.name);
        const isGlobalMatch = !skills && (emptyTagsIsGlobal ? (!effectiveTags || effectiveTags.length === 0) : !effectiveTags);
        return isSkillMatch || isTagMatch || isGlobalMatch;
    }

    // 같은 groupId는 최댓값, 아니면 (포인트, 카테고리)별 합산
    function accumulateCoreEffect(pendingGroups, effect, reqPoint) {
        const { category, val, unit, groupId } = effect;
        if (!category || val === undefined) return;

        const numVal = Number(val);
        const groupKey = groupId || `point_${reqPoint}_${category}`;
        const group = pendingGroups[groupKey];

        if (!group) {
            pendingGroups[groupKey] = { category, val: numVal, unit: unit === "%" ? "%" : "", pointList: [reqPoint] };
            return;
        }
        group.val = groupId ? Math.max(group.val, numVal) : group.val + numVal;
        if (!group.pointList.includes(reqPoint)) group.pointList.push(reqPoint);
    }

    function flushCoreGroups(stats, pendingGroups, makeSource) {
        Object.values(pendingGroups).forEach(group => {
            if (group.val === 0) return;
            addStat(stats, group.category, makeSource(group.pointList.join(',')), group.val, group.unit);
        });
    }

    // 질서 코어의 태그 추가/제거 효과 (스킬과 무관하므로 한 번만 수집)
    function collectOrderCoreTagModifiers(list, inputs, env) {
        CORE_SLOTS.forEach(slot => {
            const core = getEquippedCore(inputs?.orderCores, slot);
            if (!core) return;

            const coreData = findOrderCoreData(env.orderDataSets, core.name);
            if (!coreData) return;

            const gradesObj = coreData.grades || coreData;
            const gradeKey = findGradeKey(gradesObj, core.grade, false);
            if (!gradeKey || !gradesObj[gradeKey]) return;

            const source = `질서 코어(${core.koreanSlot}:${core.name})`;
            forEachCoreEffect(gradesObj[gradeKey], Number(core.level) || 0, (effect) => addTagModifier(list, source, effect));
        });
    }

    // 질서 코어 스탯 효과 (스킬별)
    function collectOrderCoreStats(stats, inputs, env, ctx) {
        CORE_SLOTS.forEach(slot => {
            const core = getEquippedCore(inputs?.orderCores, slot);
            if (!core) return;

            const coreData = findOrderCoreData(env.orderDataSets, core.name);
            if (!coreData) return;

            // 등급은 단일 매칭 (유물/고대 중복 가산 방지). 매칭 실패 시 아무것도 적용하지 않음
            const gradesObj = coreData.grades || coreData;
            const gradeKey = findGradeKey(gradesObj, core.grade, true);
            if (!gradeKey || !gradesObj[gradeKey]) return;

            const pendingGroups = {};
            forEachCoreEffect(gradesObj[gradeKey], Number(core.level) || 0, (effect, reqPoint) => {
                if (matchCoreEffect(effect, ctx, true)) accumulateCoreEffect(pendingGroups, effect, reqPoint);
            });

            flushCoreGroups(stats, pendingGroups, (pts) =>
                `질서 코어(${core.koreanSlot}:${core.name || '코어'}) Pt.${pts} [${gradeKey || core.grade}]`);
        });
    }

    // 혼돈 코어 스탯 효과 (스킬별)
    function collectChaosCoreStats(stats, inputs, env, ctx) {
        CORE_SLOTS.forEach(slot => {
            const core = getEquippedCore(inputs?.chaosCores, slot);
            if (!core) return;

            const matchedGrade = core.grade.includes('고대') ? '고대' : (core.grade.includes('유물') ? '유물' : null);
            if (!matchedGrade) return;

            const slotDataSet = env.chaosDataSets?.[core.koreanSlot];
            if (!slotDataSet) return;

            // 코어 이름 매칭 (직접 매칭 -> 유사 매칭)
            let coreData = slotDataSet[core.name]?.[matchedGrade];
            if (!coreData && core.name) {
                const matchedName = Object.keys(slotDataSet).find(name => core.name.includes(name) || name.includes(core.name));
                if (matchedName) coreData = slotDataSet[matchedName]?.[matchedGrade];
            }
            if (!coreData) return;

            const userLevel = Number(core.level) || 0;
            const pendingGroups = {};

            Object.keys(coreData).forEach(reqPointStr => {
                const reqPoint = Number(reqPointStr);
                if (!(userLevel >= reqPoint)) return;

                const rawEffectList = coreData[reqPointStr];
                if (!Array.isArray(rawEffectList)) return;

                rawEffectList.forEach(item => {
                    const targetEffects = Array.isArray(item.effects) ? item.effects : [item];
                    targetEffects.forEach(effect => {
                        if (matchCoreEffect(effect, ctx, false)) accumulateCoreEffect(pendingGroups, effect, reqPoint);
                    });
                });
            });

            flushCoreGroups(stats, pendingGroups, (pts) =>
                `혼돈 코어(${core.koreanSlot}:${core.name || '코어'}) Pt.${pts} [${matchedGrade}]`);
        });
    }

    // ── 5-3. 공통 스탯 (스킬과 무관) ───────────────────────────────────────────
    function createEmptyStats() {
        return {
            "주스탯":[], "주스탯 %":[],"치명": [], "신속": [],"특화":[],
            "무기 공격력": [], "무기 공격력 %": [], "기본 공격력": [], "기본 공격력 %": [], "공격력": [], "공격력 %": [],
            "진화형 피해": [], "추가 피해": [],
            "치명타 적중률": [], "치명타 피해": [], "치명타 시 적에게 주는 피해": [],
            "적에게 주는 피해": [], "방어력 무시":[],
            "이동 속도": [], "공격 속도": [], "쿨타임 감소": [],
            "마나 스킬 쿨타임 감소": [], "쿨타임 증가": [], "고정 쿨타임 감소": [],"고정 쿨타임 증가":[]
        };
    }

    function cloneStats(stats) {
        const copy = {};
        for (const key in stats) copy[key] = Array.isArray(stats[key]) ? [...stats[key]] : stats[key];
        return copy;
    }

    // ADD_STAT_BASE 항목의 개별 효과를 순회 (effects 배열형 / 단일 항목형 모두 지원)
    // withFormula: effects가 없는 단일 항목이라도 formula만 있으면 포함 (조건부 스탯 처리용)
    function forEachBaseEffect(statList, cb, withFormula = false) {
        statList.forEach(item => {
            if (!item) return;
            if (Array.isArray(item.effects)) item.effects.forEach(eff => cb(eff, item));
            else if (item.category || item.type || (withFormula && item.formula)) cb(item, item);
        });
    }

    function hasTagCondition(eff) {
        return (eff.targetTags && eff.targetTags.length > 0) ||
               (eff.requireTags && eff.requireTags.length > 0) ||
               (eff.excludeTags && eff.excludeTags.length > 0) ||
               (eff.excludeSkillTags && eff.excludeSkillTags.length > 0);
    }

    // 태그 변환(추가/제거) 효과 수집: ADD_STAT_BASE + 질서 코어. 매 연산마다 새로 만든다.
    function collectTagModifiers(inputs, env) {
        const list = [];
        forEachBaseEffect(env.statList, (eff, item) => addTagModifier(list, item.name, eff));
        collectOrderCoreTagModifiers(list, inputs, env);
        return list;
    }

    function addBaseStats(commonStats, env) {
        forEachBaseEffect(env.statList, (eff, item) => {
            const cat = eff.category || eff.type;
            if (cat === "태그 추가" || cat === "태그 제거") return;
            if (!hasTagCondition(eff) && !eff.formula) {
                addStat(commonStats, cat, item.name, eff.val ?? eff.value, eff.unit);
            }
        });
    }

    const ESTHER_BONDING1 = [145983, 153282, 257503, 453359];
    const ESTHER_BONDING2 = [3946, 4305, 7250, 16450];
    const VAMBRACE_GRADE_ATK_PERCENT = { "영웅": 0, "전설": 1, "유물": 2, "고대": 3 };

    function addEquipmentStats(commonStats, inputs, env) {
        // 방어구 주스탯
        addStat(commonStats, "주스탯", "투구", inputs.headStat, "");
        addStat(commonStats, "주스탯", "견갑", inputs.shoulderStat, "");
        addStat(commonStats, "주스탯", "상의", inputs.topStat, "");
        addStat(commonStats, "주스탯", "하의", inputs.bottomStat, "");
        addStat(commonStats, "주스탯", "장갑", inputs.gloveStat, "");

        // 무기
        const weaponLabel = inputs.isEsther ? `에스더 무기 (엘라 ${inputs.estherElla ?? 0})` : "무기";
        addStat(commonStats, "무기 공격력", weaponLabel, inputs.weaponAtk, "");

        // 에스더 결속
        if (inputs.isEsther) {
            const ellaLvl = inputs.estherElla ?? 0;
            if (env.estherBonding1) {
                const stat = ESTHER_BONDING1[ellaLvl] || 0;
                if (stat > 0) addStat(commonStats, "주스탯", `에스더 결속 1단계 (엘라 ${ellaLvl})`, stat, "");
            }
            if (env.estherBonding2) {
                const stat = ESTHER_BONDING2[ellaLvl] || 0;
                if (stat > 0) addStat(commonStats, "공격력", `에스더 결속 2단계 (엘라 ${ellaLvl})`, stat, "");
            }
        }

        // 완갑
        if (inputs.vambraceData) {
            const weaponAtk = inputs.vambraceData.무기공격력 || 0;
            if (weaponAtk > 0) addStat(commonStats, "무기 공격력", "완갑", weaponAtk, "");

            const mainStat = inputs.vambraceData.주스탯 || 0;
            if (mainStat > 0) addStat(commonStats, "주스탯", "완갑", mainStat, "");

            const baseAtk = inputs.vambraceData.기본공격력 || 0;
            if (baseAtk > 0) addStat(commonStats, "기본 공격력", "완갑", baseAtk, "");
        }

        // 완갑 등급별 기본 공격력 %
        const vambraceNormalAtkPercent = VAMBRACE_GRADE_ATK_PERCENT[inputs.vambraceGrade || "영웅"] ?? 0;
        if (vambraceNormalAtkPercent > 0) {
            addStat(commonStats, "기본 공격력 %", "완갑 기본 공격력 %", vambraceNormalAtkPercent, "%");
        }
    }

    function addArkPassiveStats(commonStats, inputs) {
        // 진화 - 진화형 피해
        const evolutionData = inputs?.arkPassive?.["진화"] || inputs?.arkPassive?.evolution;
        const evolutionRank = (typeof evolutionData === "object" && evolutionData !== null)
            ? Number(evolutionData.rank) || 0
            : Number(inputs?.arkPassive?.evolutionRank) || 0;

        if (evolutionRank > 0) {
            const statValue = Number((evolutionRank * 1).toFixed(2));
            addStat(commonStats, "진화형 피해", `아크 패시브 진화 (Rank.${evolutionRank})`, statValue, "%");
        }

        // 깨달음 - 무기 공격력 %
        const enlightenData = inputs?.arkPassive?.["깨달음"] || inputs?.arkPassive?.enlighten;
        let enlightenLevel = 0;
        if (typeof enlightenData === "object" && enlightenData !== null) {
            enlightenLevel = Number(enlightenData.level) || 0;
        } else if (Array.isArray(enlightenData)) {
            const atkNode = enlightenData.find(node => node.name && (node.name.includes("무기 공격력") || node.name.includes("깨달음")));
            enlightenLevel = Number(atkNode?.level) || 0;
        } else {
            enlightenLevel = Number(inputs?.arkPassive?.enlightenLevel) || 0;
        }

        if (enlightenLevel > 0) {
            const statValue = Number((enlightenLevel * 0.1).toFixed(2));
            addStat(commonStats, "무기 공격력 %", `아크 패시브 깨달음 (Lv.${enlightenLevel})`, statValue, "%");
        }
    }

    const PERCENT_STAT_LIST = ["공격력 %", "무기 공격력 %", "치명타 피해", "치명타 적중률", "피해 증가", "추가 피해", "적에게 주는 피해"];

    // 장신구 옵션 문구 -> accessoryTable 키
    function matchAccessoryKey(rawKey) {
        const keys = Object.keys(accessoryTable);
        let matchedKey = keys.find(k => k.trim() === rawKey);
        if (matchedKey) return matchedKey;

        if (rawKey.includes("아군 공격력") || rawKey.includes("아공강")) return keys.find(k => k.includes("아군 공격력")) || "아군 공격력 강화 효과 %";
        if (rawKey.includes("아군 피해") || rawKey.includes("아피강")) return keys.find(k => k.includes("아군 피해")) || "아군 피해 강화 효과 %";
        if (rawKey.includes("낙인력")) return keys.find(k => k.includes("낙인력")) || "낙인력 %";
        if (rawKey.includes("무기 공격력") && rawKey.includes("%")) return "무기 공격력 %";
        if (rawKey.includes("무기 공격력")) return "무기 공격력";
        if (rawKey.includes("공격력") && rawKey.includes("%")) return "공격력 %";
        if (rawKey.includes("공격력")) return "공격력";
        if (rawKey.includes("치명타 적중률") || rawKey.includes("치적")) return "치명타 적중률";
        if (rawKey.includes("치명타 피해") || rawKey.includes("치피")) return "치명타 피해";
        if (rawKey.includes("추가 피해") || rawKey.includes("추피")) return "추가 피해";
        if (rawKey.includes("적에게 주는 피해") || rawKey.includes("적주피")) return "적에게 주는 피해";
        return undefined;
    }

    function addAccessoryStats(commonStats, inputs) {
        inputs.accessories.forEach(acc => {
            addStat(commonStats, "주스탯", acc.name, acc.statValue, "");
            acc.slots.forEach((slot, idx) => {
                if (!slot || !slot.opt || slot.opt === "none" || slot.opt === "없음") return;

                const matchedKey = matchAccessoryKey(slot.opt.trim());
                if (matchedKey && accessoryTable[matchedKey]?.[slot.grade] !== undefined) {
                    const val = accessoryTable[matchedKey][slot.grade];
                    const isPercent = matchedKey.includes("%") || PERCENT_STAT_LIST.includes(matchedKey);
                    addStat(commonStats, matchedKey, `장신구: ${acc.name} (슬롯${idx + 1}) [${matchedKey} - ${slot.grade}]`, val, isPercent ? "%" : "");
                }
            });
        });
    }

    // 아크 그리드 젬 + 스킬 보석(공증). 스킬 보석 맵(skillGemMap)을 반환
    function addGemStats(commonStats, inputs) {
        addStat(commonStats, "공격력 %", "젬: 공격력", inputs.gems.atk);
        addStat(commonStats, "추가 피해", "젬: 추가 피해", inputs.gems.addDmg);
        addStat(commonStats, "적에게 주는 피해", "젬: 보스 피해", inputs.gems.bossDmg);

        const skillGemMap = {};
        inputs.skillGems.forEach(gem => {
            const gemAtkVal = gemDataTable["공증"]?.[gem.level] || 0;
            if (gemAtkVal > 0) {
                addStat(commonStats, "기본 공격력 %", `보석(${gem.type}): ${gem.skillName} [${gem.level}레벨]`, parseFloat(gemAtkVal.toFixed(2)));
            }
            if (!skillGemMap[gem.skillName]) skillGemMap[gem.skillName] = [];
            skillGemMap[gem.skillName].push({ type: gem.type, level: gem.level });
        });
        return skillGemMap;
    }

    // 팔찌: 스탯 + 옵션. 태그 조건이 붙은 옵션은 스킬별 적용을 위해 배열로 반환
    function addBraceletStats(commonStats, inputs) {
        [['crit', '치명'], ['swift', '신속'], ['spec', '특화'], ['mainStat', '주스탯']].forEach(([key, category]) => {
            const val = inputs.bracelet?.[key];
            if (val) addStat(commonStats, category, "팔찌", val, "");
        });

        const braceletSkillEffects = [];
        (inputs?.bracelet?.options || []).forEach((opt, i) => {
            if (!opt || !opt.opt || opt.opt === "none") return;

            const optionEffects = getBraceletOptionData(opt.opt, opt.grade);
            if (optionEffects.length === 0) {
                console.warn(`[팔찌 옵션 매칭 실패] 원본: "${opt.opt}", 등급: "${opt.grade}"`);
                return;
            }

            const source = `팔찌 옵션 ${i + 1} (${opt.opt} - ${opt.grade})`;
            optionEffects.forEach(eff => {
                if (!eff.requireTags || eff.requireTags.length === 0) {
                    addStat(commonStats, eff.category, source, eff.val);            // 모든 스킬 공통
                } else {
                    braceletSkillEffects.push({ source, category: eff.category, val: eff.val, unit: eff.unit, requireTags: eff.requireTags });
                }
            });
        });
        return braceletSkillEffects;
    }

    function buildCommonStats(inputs, env) {
        const commonStats = createEmptyStats();

        const partyCritBonus = env.partyCritCount * STAT_CONSTANTS.PARTY_CRIT_SYNERGY_PER_PLAYER;
        if (partyCritBonus > 0) {
            addStat(commonStats, "치명타 적중률", `파티 시너지 (${env.partyCritCount}명)`, partyCritBonus);
        }

        addBaseStats(commonStats, env);
        addEquipmentStats(commonStats, inputs, env);
        addArkPassiveStats(commonStats, inputs);
        addAccessoryStats(commonStats, inputs);
        const skillGemMap = addGemStats(commonStats, inputs);
        const braceletSkillEffects = addBraceletStats(commonStats, inputs);

        return { commonStats, skillGemMap, braceletSkillEffects };
    }

    const MAX_TAG_PASSES = 10;

    // ── 5-4. 스킬별 조건부 스탯 ────────────────────────────────────────────────
    // 태그 확정: 기본 태그 -> 선택한 트라이포드의 태그 추가/제거 -> 전역 태그 변환
    function resolveSkillTags(skillData, env, tagModifiers) {
        const { name: skillName, tags: baseTags = [], tripods: currentTripods = [] } = skillData;
        const tagSet = new Set(baseTags);

        const selectedForThisSkill = env.selectedTripods[skillName] || env.selectedTripods[skillData.id] || {};
        const selectedNames = Object.values(selectedForThisSkill);

        if (Array.isArray(currentTripods)) {
            currentTripods.forEach(tp => {
                if (!selectedNames.includes(tp.name)) return;
                const effects = Array.isArray(tp.effects) ? tp.effects : [tp];
                effects.forEach(eff => {
                    if ((eff.category === "태그 추가" || eff.type === "태그 추가") && eff.val) tagSet.add(eff.val.trim());
                    if ((eff.category === "태그 제거" || eff.type === "태그 제거") && eff.val) tagSet.delete(eff.val.trim());
                });
            });
        }

        // 전역 태그 변환: 규칙 순서와 무관하게 연쇄 변환(A가 만든 태그를 B가 요구)이 풀리도록
        // 더 이상 변화가 없을 때까지 반복 적용한다 (추가/제거가 엇갈려 진동하는 경우를 대비해 횟수 제한)
        for (let pass = 0; pass < MAX_TAG_PASSES; pass++) {
            let changed = false;
            tagModifiers.forEach(mod => {
                const ctx = { tags: Array.from(tagSet), name: skillName };
                if (!matchTags(ctx, { require: mod.requireTags, exclude: mod.excludeTags }, { all: true })) return;
                if (mod.action === "ADD" && !tagSet.has(mod.targetTag)) { tagSet.add(mod.targetTag); changed = true; }
                else if (mod.action === "REMOVE" && tagSet.has(mod.targetTag)) { tagSet.delete(mod.targetTag); changed = true; }
            });
            if (!changed) break;
        }

        return { skillTags: Array.from(tagSet), selectedNames };
    }

    function applyBraceletSkillEffects(stats, braceletSkillEffects, ctx) {
        braceletSkillEffects.forEach(effect => {
            if (matchTags(ctx, { require: effect.requireTags }, { all: true, reqName: false })) {
                addStat(stats, effect.category, effect.source, effect.val);
            }
        });
    }

    // ADD_STAT_BASE 중 태그 조건이 있는 스탯은 바로 반영, 수식(formula)은 나중에 평가하도록 반환
    function applyConditionalBaseStats(stats, env, ctx) {
        const pendingFormulas = [];

        forEachBaseEffect(env.statList, (eff, item) => {
            const exTags = eff.excludeTags || eff.excludeSkillTags || [];
            const reqTags = eff.targetTags || eff.requireTags || eff.requireSkillTags || [];
            if (!matchTags(ctx, { require: reqTags, exclude: exTags })) return;

            const formulaStr = eff.formula || item.formula;
            if (formulaStr) {
                pendingFormulas.push({
                    category: eff.category || eff.type || item.category || item.type,
                    name: item.name,
                    formula: formulaStr,
                    unit: eff.unit ?? item.unit ?? "%"
                });
            } else {
                const val = eff.val ?? eff.value ?? item.val ?? item.value;
                if (val !== undefined && (reqTags.length > 0 || exTags.length > 0)) {
                    addStat(stats, eff.category || eff.type, item.name, val, eff.unit ?? "%");
                }
            }
        }, true);

        return pendingFormulas;
    }

    function applyTripodStats(stats, skillData, selectedNames, ctx) {
        const currentTripods = skillData.tripods || [];
        if (!Array.isArray(currentTripods)) return;

        currentTripods.forEach(tp => {
            if (!selectedNames.includes(tp.name)) return;

            const exTags = tp.excludeTags || tp.excludeSkillTags || [];
            const reqTags = tp.requireTags || tp.requireSkillTags || (tp.requiredTag ? [tp.requiredTag] : []);
            if (!matchTags(ctx, { require: reqTags, exclude: exTags }, { exName: false })) return;

            const sourceType = `트라이포드(${tp.tier ? tp.tier + '트포 - ' : ''}${tp.name})`;
            const processEffect = (eff) => {
                if (eff.category !== "태그 추가" && eff.category !== "태그 제거" && eff.type !== "태그 추가" && eff.type !== "태그 제거") {
                    addStat(stats, eff.category || eff.type, sourceType, eff.val, eff.unit ?? "%");
                }
            };

            if (Array.isArray(tp.effects)) tp.effects.forEach(processEffect);
            else if (tp.category && tp.val !== undefined) processEffect(tp);
        });
    }

    function applyEngravingStats(stats, inputs, ctx) {
        inputs.engravings.forEach(eng => {
            if (!eng || eng.name === "none" || eng.level === "미사용") return;

            const engData = engravingTable[eng.name];
            if (!engData) return;

            const exTags = engData.excludeTags || engData.excludeSkillTags || [];
            const reqTags = engData.requireTags || engData.requireSkillTags || [];
            if (!matchTags(ctx, { require: reqTags, exclude: exTags }, { exName: false, reqName: false })) return;

            const levelEffects = engData.levels?.[eng.level] || [];
            const stoneEffects = engData.stone?.[eng.stone] || [];

            if (eng.name === "돌격대장") {
                const raidFactor = (levelEffects[0]?.val || 0) + (stoneEffects[0]?.val || 0);
                if (raidFactor > 0) {
                    stats["_돌격대장계수"] = raidFactor / 100;
                    stats["_돌격대장정보"] = `각인: 돌격대장 [${eng.level} + 세공 ${eng.stone}]`;
                }
                return;
            }

            levelEffects.forEach(eff => {
                const matchingStone = stoneEffects.find(s => s.type === eff.type);
                const stoneVal = matchingStone ? (Number(matchingStone.val) || 0) : 0;
                const totalVal = parseFloat(((Number(eff.val) || 0) + stoneVal).toFixed(2));
                addStat(stats, eff.type, `각인: ${eng.name} [${eng.level} + 세공 ${eng.stone}]`, totalVal, eff.unit || "%");
            });
        });
    }

    function applySkillGemStats(stats, skillGemMap, skillName) {
        (skillGemMap[skillName] || []).forEach(({ type, level }) => {
            if (type === "겁화") {
                addStat(stats, "적에게 주는 피해", `보석(겁화): ${skillName} [${level}레벨]`, parseFloat(((gemDataTable["겁화"][level] - 1) * 100).toFixed(2)));
            } else if (type === "작열") {
                addStat(stats, "쿨타임 감소", `보석(작열): ${skillName} [${level}레벨]`, parseFloat(((1 - gemDataTable["작열"][level]) * 100).toFixed(2)));
            }
        });
    }

    function applyArkEvolutionStats(stats, arkStats, ctx) {
        if (!arkStats || typeof arkStats !== 'object') return;

        for (const cat in arkStats) {
            if (!Array.isArray(arkStats[cat])) continue;
            arkStats[cat].forEach(eff => {
                const exTags = eff.excludeTags || eff.excludeSkillTags || [];
                const reqTags = eff.requireTags || eff.requireSkillTags || [];
                if (!matchTags(ctx, { require: reqTags, exclude: exTags }, { exName: false, reqName: false })) return;
                addStat(stats, cat, eff.source, eff.val, eff.unit);
            });
        }
    }

    // ── 5-5. 수치 연산 ─────────────────────────────────────────────────────────
    function computeAttack(stats, inputs) {
        const totalStoneLevel = Array.isArray(inputs.engravings)
            ? inputs.engravings.reduce((sum, eng) => sum + (parseInt(eng?.stone, 10) || 0), 0)
            : 0;
        const carveAtkBonusPercent = totalStoneLevel >= 5 ? 1.5 : 0;

        const finalStat = getStatSum(stats, "주스탯") * (1 + getStatSum(stats, "주스탯 %") / 100);
        const weaponAtkPercent = getStatSum(stats, "무기 공격력 %");
        const finalWeaponAtk = getStatSum(stats, "무기 공격력") * (1 + (weaponAtkPercent / 100));
        const normalAtkPercent = getStatSum(stats, "기본 공격력 %");

        const calculatedBaseAtk = finalStat > 0 && finalWeaponAtk > 0
            ? (Math.sqrt((finalStat * finalWeaponAtk) / 6)) * (1 + (normalAtkPercent + carveAtkBonusPercent) / 100)
            : 0;

        const flatAtkBonus = getStatSum(stats, "공격력");
        const percentAtkBonus = getStatSum(stats, "공격력 %");
        const finalAtk = (calculatedBaseAtk + flatAtkBonus) * (1 + (percentAtkBonus / 100));

        return { totalStoneLevel, carveAtkBonusPercent, finalStat, weaponAtkPercent, finalWeaponAtk, normalAtkPercent, calculatedBaseAtk, finalAtk };
    }

    function computeSpeed(stats) {
        const totalSwift = getStatSum(stats, "신속");
        const swiftSpeedBonus = totalSwift * STAT_CONSTANTS.SWIFT_TO_SPEED;
        return {
            totalSwift,
            finalAtkSpeed: swiftSpeedBonus + getStatSum(stats, "공격 속도"),
            finalMoveSpeed: swiftSpeedBonus + getStatSum(stats, "이동 속도")
        };
    }

    // 수식(formula) 평가. 컴파일 결과는 수식 문자열별로 캐시한다.
    const formulaCache = new Map();
    function evaluatePendingFormulas(stats, pendingFormulas, formulaContext) {
        const keys = Object.keys(formulaContext);
        const values = Object.values(formulaContext);

        pendingFormulas.forEach(item => {
            try {
                let fn = formulaCache.get(item.formula);
                if (!fn) {
                    fn = new Function(...keys, `return ${item.formula};`);
                    formulaCache.set(item.formula, fn);
                }
                const calcVal = fn(...values);
                if (typeof calcVal === 'number' && !isNaN(calcVal)) {
                    addStat(stats, item.category, item.name, parseFloat(calcVal.toFixed(2)), item.unit);
                }
            } catch (err) {
                console.error(`[수식 계산 실패] ${item.name}:`, item.formula, err);
            }
        });
    }

    // 아크 패시브 진화 5티어(뭉툭한 가시 / 음속 돌파 / 마나 용광로) + 돌격대장
    function applyTier5Stats(stats, tier5, d) {
        let totalBluntDmg = 0, totalSonicDmg = 0, capCritRate = false;
        const { bluntThornNode, sonicsNode, MpFurnaceNode } = tier5;

        if (bluntThornNode && bluntThornNode.current > 0) {
            const excessCrit = Math.max(0, (d.totalCritRatePercent / 100 - 0.8) * 100);
            const lv = bluntThornNode.current;
            const baseDmg = lv === 1 ? 7.5 : 15.0;
            const ratio   = lv === 1 ? 1.25 : 1.5;
            const maxDmg  = lv === 1 ? 52.5 : 75.0;

            totalBluntDmg = Math.min(maxDmg, baseDmg + (excessCrit * ratio));
            capCritRate = true;
            addStat(stats, "진화형 피해", `아크 패시브(진화 5티어): 뭉툭한 가시 [${lv}/${bluntThornNode.max}LV]`, parseFloat(totalBluntDmg.toFixed(2)));
        }

        if (stats["_돌격대장계수"]) {
            const moveSpeedBonus = Math.min(STAT_CONSTANTS.SPEED_CAP, Math.max(0, d.finalMoveSpeed));
            addStat(stats, "적에게 주는 피해", `${stats["_돌격대장정보"]} (이속 +${moveSpeedBonus.toFixed(2)}% 적용)`, parseFloat((moveSpeedBonus * stats["_돌격대장계수"]).toFixed(2)));
        }

        if (sonicsNode && sonicsNode.current > 0) {
            const CAP = STAT_CONSTANTS.SPEED_CAP;
            const atkBonus = Math.max(0, d.finalAtkSpeed);
            const moveBonus = Math.max(0, d.finalMoveSpeed);
            let sonicDmg = (Math.min(CAP, atkBonus) + Math.min(CAP, moveBonus)) * 0.1;
            sonicDmg += (Math.max(0, atkBonus - CAP) + Math.max(0, moveBonus - CAP)) * 0.3;
            if (atkBonus > CAP && moveBonus > CAP) sonicDmg += 8;
            if (sonicsNode.current === 1) sonicDmg *= 0.5;
            totalSonicDmg = Math.min(STAT_CONSTANTS.SONICS_MAX_DMG, sonicDmg);
            addStat(stats, "진화형 피해", `아크 패시브(진화 5티어): 음속 돌파 [${sonicsNode.current}/${sonicsNode.max}LV]`, parseFloat(totalSonicDmg.toFixed(2)));
        }

        if (MpFurnaceNode && MpFurnaceNode.current > 0) {
            let furnaceDmg = Math.min(24, d.mana * 0.05);
            if (MpFurnaceNode.current === 1) furnaceDmg *= 0.5;
            if (furnaceDmg > 0) {
                addStat(stats, "진화형 피해", `아크 패시브(진화 5티어): 마나 용광로 [${MpFurnaceNode.current}/${MpFurnaceNode.max}LV]`, parseFloat(furnaceDmg.toFixed(2)));
            }
        }

        return { totalBluntDmg, totalSonicDmg, capCritRate };
    }

    // 특화 스탯 -> 적에게 주는 피해 (특화 DB의 태그별 계수 합산)
    function applySpecializationStats(stats, specDB, ctx) {
        const specStatValue = getStatSum(stats, "특화");
        if (!(specStatValue > 0) || !specDB) return;

        // 단일 객체 / 배열 / 키-값 객체 어떤 구조든 targetTags를 가진 항목을 모두 추출
        const getSpecItems = (db) => {
            if (!db || typeof db !== 'object') return [];
            if (Array.isArray(db.targetTags)) return [db];
            if (Array.isArray(db)) return db.flatMap(getSpecItems);
            return Object.values(db).flatMap(getSpecItems);
        };

        let totalSpecCoeff = 0;
        getSpecItems(specDB).forEach(item => {
            if (!item || typeof item !== 'object' || !Array.isArray(item.targetTags) || item.targetTags.length === 0) return;
            const exTags = item.excludeTags || item.excludeSkillTags || [];
            if (matchTags(ctx, { require: item.targetTags, exclude: exTags })) {
                totalSpecCoeff += Number(item.coefficient) || 0;
            }
        });

        if (totalSpecCoeff > 0) {
            const specDamageValue = specStatValue * totalSpecCoeff / 699 * 100;
            addStat(stats, "적에게 주는 피해", "특화 효과", parseFloat(specDamageValue.toFixed(2)), "%");
        }
    }

    function computeCooldown(stats, baseCooldown, totalSwift) {
        const swiftMultiplier = 1 - ((totalSwift * STAT_CONSTANTS.SWIFT_TO_CDR) / 100);
        const appliedManaCdrMultiplier = 1 - (getStatSum(stats, "마나 스킬 쿨타임 감소") / 100);

        const isPassiveCdr = (i) => i && i.source && (i.source.includes('최적화 훈련') || i.source.includes('타이밍 지배'));
        const allCdrList = stats['쿨타임 감소'] || [];
        const passiveCdrMultiplier = 1 - (allCdrList.filter(isPassiveCdr).reduce((s, c) => s + (Number(c.val) || 0), 0) / 100);
        const otherCdrMultiplier = allCdrList
            .filter(i => !i.source?.includes('최적화 훈련') && !i.source?.includes('타이밍 지배'))
            .reduce((acc, cur) => acc * (1 - cur.val / 100), 1.0);
        const cdrIncreaseMultiplier = 1 + (getStatSum(stats, "쿨타임 증가") / 100);

        const adjustedBaseCooldown = Math.max(0, baseCooldown - getStatSum(stats, "고정 쿨타임 감소"));
        return adjustedBaseCooldown * swiftMultiplier * appliedManaCdrMultiplier * passiveCdrMultiplier * otherCdrMultiplier * cdrIncreaseMultiplier;
    }

    // ── 5-5b. 기대 데미지 (다중 치명타 포함) ───────────────────────────────────
    /**
     * 치명타 적중률이 100%를 넘으면 초과분이 '추가 치명타' 확률이 된다 (다중 치명타).
     *  - 일반 치명타 배율 = 치명타 피해 / 100            (예: 300% -> 3배)
     *  - 추가 치명타 배율 = 치명타 배율 + (치명타 배율 - 1) (예: 피해 1, 치피 300% -> 3이 아니라 5)
     *  - 추가 치명타에도 '치명타 시 적에게 주는 피해' 배율을 동일하게 적용 (가정)
     * extraCritRate가 0이면 기존 계산과 완전히 같다.
     */
    function computeExpectedDamage({ nonCritBaseDamage, critBaseDamage, critRate, extraCritRate = 0, critDamagePercent, critHitMultiplier }) {
        let expDmg = critBaseDamage * critRate + nonCritBaseDamage * (1 - critRate);
        let extraCritBaseDamage = 0;

        if (extraCritRate > 0) {
            const critMult = critDamagePercent / 100;
            extraCritBaseDamage = nonCritBaseDamage * (2 * critMult - 1) * critHitMultiplier;
            expDmg += critRate * extraCritRate * (extraCritBaseDamage - critBaseDamage);
        }
        return { expDmg, extraCritBaseDamage };
    }

    // ── 5-6. 스킬 하나의 최종 결과 ─────────────────────────────────────────────
    function calculateOneSkill(skillData, inputs, env, shared) {
        const { name: skillName, coefficient, constant, baseCooldown = 0, mana } = skillData;

        const stats = cloneStats(shared.commonStats);
        const { skillTags, selectedNames } = resolveSkillTags(skillData, env, shared.tagModifiers);
        const ctx = { tags: skillTags, name: skillName };

        // 조건부 스탯 수집
        applyBraceletSkillEffects(stats, shared.braceletSkillEffects, ctx);
        collectChaosCoreStats(stats, inputs, env, ctx);
        const pendingFormulas = applyConditionalBaseStats(stats, env, ctx);
        applyTripodStats(stats, skillData, selectedNames, ctx);
        applyEngravingStats(stats, inputs, ctx);
        applySkillGemStats(stats, shared.skillGemMap, skillName);
        applyArkEvolutionStats(stats, shared.arkStats, ctx);
        collectOrderCoreStats(stats, inputs, env, ctx);

        // 기본 수치
        const defPenMultiplier = getDefPenMultiplier(stats);
        const attack = computeAttack(stats, inputs);
        const speed = computeSpeed(stats);
        const { totalSwift, finalAtkSpeed, finalMoveSpeed } = speed;
        const { finalAtk } = attack;

        // 수식은 공격력/속도가 확정된 뒤 평가
        if (pendingFormulas.length > 0) {
            evaluatePendingFormulas(stats, pendingFormulas, {
                finalMoveSpeed, finalAtkSpeed, totalSwift, finalAtk,
                totalCritStat: getStatSum(stats, "치명"),
                totalSwiftStat: getStatSum(stats, "신속"),
                totalSpecStat: getStatSum(stats, "특화"),
                Math
            });
        }

        const baseDamage = calculateDamageBase(finalAtk, coefficient, constant, defPenMultiplier);

        const totalCritStat = getStatSum(stats, "치명");
        const totalCritRatePercent = (totalCritStat * STAT_CONSTANTS.CRIT_TO_RATE) + getStatSum(stats, "치명타 적중률");
        let critRate = Math.min(totalCritRatePercent / 100, 1.0);

        const { totalBluntDmg, totalSonicDmg, capCritRate } =
            applyTier5Stats(stats, shared.tier5, { totalCritRatePercent, finalAtkSpeed, finalMoveSpeed, mana });
        // 다중 치명타: 100% 초과분이 추가 치명타 확률 (최대 100%로 제한). 뭉툭한 가시는 치적을 80%로 제한하므로 해당 없음
        let extraCritRate = env.multiCrit ? Math.min(Math.max(totalCritRatePercent / 100 - 1, 0), 1.0) : 0;
        if (capCritRate) { critRate = Math.min(critRate, 0.8); extraCritRate = 0; }

        const totalAdditionalDamageMuntiplier = 1 + (getStatSum(stats, "추가 피해") / 100);
        if (!stats["추가 피해"]) stats["추가 피해"] = [];

        const totalEvolutionDamage = getStatSum(stats, "진화형 피해");
        const evolutionDamageMultiplier = 1 + (totalEvolutionDamage / 100);

        if (!stats["적에게 주는 피해"]) stats["적에게 주는 피해"] = [];

        const specStatValue = getStatSum(stats, "특화");
        applySpecializationStats(stats, env.specDB, ctx);

        // 표시용 정렬: 트라이포드/깨달음/도약 출처를 앞으로
        const isSkillSpec = (source) => source.startsWith("트라이포드") || source.startsWith("깨달음") || source.startsWith("도약");
        stats["적에게 주는 피해"] = [
            ...stats["적에게 주는 피해"].filter(item => isSkillSpec(item.source)),
            ...stats["적에게 주는 피해"].filter(item => !isSkillSpec(item.source))
        ];

        const totalDamageMultiplier = getStatProduct(stats, "적에게 주는 피해", true);
        const totalCritDamagePercent = getStatSum(stats, "치명타 피해");
        const critHitDamageMultiplier = getStatProduct(stats, "치명타 시 적에게 주는 피해", true);

        const nonCritBaseDamage = baseDamage * totalDamageMultiplier * evolutionDamageMultiplier * totalAdditionalDamageMuntiplier;
        const critBaseDamage = nonCritBaseDamage * (totalCritDamagePercent / 100) * critHitDamageMultiplier;
        const { expDmg, extraCritBaseDamage } = computeExpectedDamage({
            nonCritBaseDamage, critBaseDamage, critRate, extraCritRate,
            critDamagePercent: totalCritDamagePercent, critHitMultiplier: critHitDamageMultiplier
        });

        const finalCooldown = computeCooldown(stats, baseCooldown, totalSwift);

        return {
            skillName,
            inputs,
            weaponAtkPercent: attack.weaponAtkPercent,
            finalStat: attack.finalStat,
            finalWeaponAtk: attack.finalWeaponAtk,
            normalAtkPercent: attack.normalAtkPercent,
            carveAtkBonusPercent: attack.carveAtkBonusPercent,
            totalStoneLevel: attack.totalStoneLevel,
            calculatedBaseAtk: attack.calculatedBaseAtk,
            flatAtkBonus: getStatSum(stats, "공격력"),
            percentAtkBonus: getStatSum(stats, "공격력 %"),
            vambraceNormalAtk: getStatSum(stats, "기본 공격력"),
            vambraceNormalAtkPercent: getStatSum(stats, "기본 공격력 %"),
            finalAtk,
            totalCritStat,
            totalSwiftStat: totalSwift,
            specStatValue,
            totalCritRatePercent,
            extraCritRate,
            extraCritBaseDamage,
            totalEvolutionDamage,
            finalAtkSpeed,
            finalMoveSpeed,
            totalBluntDmg,
            totalSonicDmg,
            expDmg,
            finalCooldown,
            stats
        };
    }

    // 모든 스킬 계산 (UI/알림 없음)
    function computeAllSkills(inputs, env, skillDatabase) {
        const { commonStats, skillGemMap, braceletSkillEffects } = buildCommonStats(inputs, env);

        const shared = {
            commonStats,
            skillGemMap,
            braceletSkillEffects,
            tagModifiers: collectTagModifiers(inputs, env),
            arkStats: getArkEvolutionStats(),
            tier5: {
                bluntThornNode: evolutionNodes[4]?.find(node => node.isBluntThorn),
                sonicsNode: evolutionNodes[4]?.find(node => node.isSonics),
                MpFurnaceNode: evolutionNodes[4]?.find(node => node.isMPFurnace)
            }
        };

        const results = [];
        skillDatabase.forEach(skillData => results.push(calculateOneSkill(skillData, inputs, env, shared)));
        return results;
    }

    // 진입점: 스킬 데이터 검증(알림 포함) 후 계산
    function calculateSkillStats(inputs) {
        const db = window.skillDatabase;

        if (!db ||
            (Array.isArray(db) && db.length === 0) ||
            (typeof db === 'object' && Object.keys(db).length === 0)) {
            showAlert('스킬 데이터가 존재하지 않습니다. 스킬 데이터를 먼저 업로드해 주세요.');
            toggleCalcPause();
            return;
        }

        if (typeof db.forEach !== 'function') {
            showAlert('스킬 데이터 형식이 올바르지 않습니다. 다시 업로드해 주세요.');
            toggleCalcPause();
            return;
        }

        return computeAllSkills(inputs, readEngineEnv(inputs), db);
    }



    // =============================================================================
    // 6. UI 초기화 및 결과 출력 함수
    // =============================================================================

    // 접이식 섹션(summary) 헤더 공통 스타일. color만 섹션마다 다름
    function makeSectionHeaderStyle(color) {
        return `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: #181920;
            border: 1px solid #2e323d;
            border-radius: 8px;
            color: ${color};
            font-size: 1.1rem;
            font-weight: bold;
            cursor: pointer;
            user-select: none;
            transition: background 0.2s;
        `;
    }

    window.closeSimModal = function() {
        const modal = document.getElementById('sim-result-modal');
        if (modal) modal.style.display = 'none';
    };

    // 전역 변수로 섹션들의 열림 상태 기억 (기본값: 모두 true)
    if (!window.sectionOpenStates) {
        window.sectionOpenStates = {
            sec1: true,
            sec2: true,
            sec3: true
        };
    }

    window.renderResultsHTML = function(allSkillResults, selectedSkillIdx = null) {
        if (!allSkillResults || allSkillResults.length === 0) return;

        window.lastSkillResults = allSkillResults;

        if (selectedSkillIdx !== null && selectedSkillIdx !== undefined) {
            window.currentSelectedSkillIdx = selectedSkillIdx;
        } else if (window.currentSelectedSkillIdx === undefined) {
            window.currentSelectedSkillIdx = 0;
        }

        const currentIdx = window.currentSelectedSkillIdx;
        const commonRes = allSkillResults[0];
        let bodyContent = ``;

        // ----------------------------------------------------
        // 섹션공통 스타일
        // ----------------------------------------------------
        const sectionHeaderStyle = makeSectionHeaderStyle('#c084fc');


        // ----------------------------------------------------
        // [SECTION 1] 공통 세팅 지표 + 스킬별 시뮬레이션 요약
        // ----------------------------------------------------
        const sec1Open = window.sectionOpenStates.sec1 ? 'open' : '';
        const sec1Arrow = window.sectionOpenStates.sec1 ? '▼' : '▲';

        bodyContent += `
            <details data-sec-key="sec1" ${sec1Open} style="margin-bottom: 20px;">
                <summary style="${sectionHeaderStyle}">
                    <span>📊 [1. 캐릭터 공통 세팅 및 스킬 요약]</span>
                    <span class="toggle-icon" style="font-size: 0.8rem; color: #94a3b8;">${sec1Arrow}</span>
                </summary>
                <div style="padding-top: 16px;">

                    <!-- 공통 세팅 지표 카드들 (10개 카드 / 5x2 고정 그리드 배치) -->
                    <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 20px;">
                        <!-- 1. 최종 공격력 -->
                        <div style="background: #181920; border: 1px solid #2e323d; padding: 12px; border-radius: 8px;">
                            <div style="font-size: 0.8rem; color: #94a3b8;">최종 공격력</div>
                            <div style="font-size: 1.05rem; font-weight: bold; margin-top: 4px; color: #38bdf8;">${Math.floor(commonRes.finalAtk || 0).toLocaleString()}</div>
                        </div>

                        <!-- 2. 치명 -->
                        <div style="background: #181920; border: 1px solid #2e323d; padding: 12px; border-radius: 8px;">
                            <div style="font-size: 0.8rem; color: #e2e8f0; font-weight: 600;">치명</div>
                            <div style="font-size: 1.05rem; font-weight: bold; margin-top: 4px; color: #38bdf8;">${commonRes.totalCritStat || 0}</div>
                        </div>

                        <!-- 3. 신속 -->
                        <div style="background: #181920; border: 1px solid #2e323d; padding: 12px; border-radius: 8px;">
                            <div style="font-size: 0.8rem; color: #e2e8f0; font-weight: 600;">신속</div>
                            <div style="font-size: 1.05rem; font-weight: bold; margin-top: 4px; color: #38bdf8;">${commonRes.totalSwiftStat || 0}</div>
                        </div>

                        <!-- 4. 특화 -->
                        <div style="background: #181920; border: 1px solid #2e323d; padding: 12px; border-radius: 8px;">
                            <div style="font-size: 0.8rem; color: #e2e8f0; font-weight: 600;">특화</div>
                            <div style="font-size: 1.05rem; font-weight: bold; margin-top: 4px; color: #38bdf8;">${commonRes.specStatValue || 0}</div>
                        </div>

                        <!-- 5. 치명타 적중률 -->
                        <div style="background: #181920; border: 1px solid #2e323d; padding: 12px; border-radius: 8px;">
                            <div style="font-size: 0.8rem; color: #94a3b8;">치명타 적중률</div>
                            <div style="font-size: 1.05rem; font-weight: bold; margin-top: 4px; color: #38bdf8;">${(commonRes.totalCritRatePercent || 0).toFixed(2)}%</div>
                            ${commonRes.extraCritRate > 0 ? `<div style="font-size: 0.72rem; margin-top: 2px; color: #fcd34d;">추가 치명타 ${(commonRes.extraCritRate * 100).toFixed(2)}%</div>` : ''}
                        </div>

                        <!-- 6. 진화형 피해 -->
                        <div style="background: #181920; border: 1px solid #2e323d; padding: 12px; border-radius: 8px;">
                            <div style="font-size: 0.8rem; color: #94a3b8;">진화형 피해</div>
                            <div style="font-size: 1.05rem; font-weight: bold; margin-top: 4px; color: #38bdf8;">+${(commonRes.totalEvolutionDamage || 0).toFixed(2)}%</div>
                        </div>

                        <!-- 7. 공격 속도 -->
                        <div style="background: #181920; border: 1px solid #2e323d; padding: 12px; border-radius: 8px;">
                            <div style="font-size: 0.8rem; color: #94a3b8;">공격 속도</div>
                            <div style="font-size: 1.05rem; font-weight: bold; margin-top: 4px; color: #38bdf8;">${(commonRes.finalAtkSpeed || 0).toFixed(1)}%</div>
                        </div>

                        <!-- 8. 이동 속도 -->
                        <div style="background: #181920; border: 1px solid #2e323d; padding: 12px; border-radius: 8px;">
                            <div style="font-size: 0.8rem; color: #94a3b8;">이동 속도</div>
                            <div style="font-size: 1.05rem; font-weight: bold; margin-top: 4px; color: #38bdf8;">${(commonRes.finalMoveSpeed || 0).toFixed(1)}%</div>
                        </div>

                        <!-- 9. 뭉툭한 가시 효율 -->
                        <div style="background: #181920; border: 1px solid #2e323d; padding: 12px; border-radius: 8px;">
                            <div style="font-size: 0.8rem; color: #94a3b8;">뭉툭한 가시 효율</div>
                            <div style="font-size: 1.05rem; font-weight: bold; margin-top: 4px; color: #38bdf8;">+${(commonRes.totalBluntDmg || commonRes.totalBluntThornDmg || 0).toFixed(2)}%</div>
                        </div>

                        <!-- 10. 음속 돌파 효율 -->
                        <div style="background: #181920; border: 1px solid #2e323d; padding: 12px; border-radius: 8px;">
                            <div style="font-size: 0.8rem; color: #94a3b8;">음속 돌파 효율</div>
                            <div style="font-size: 1.05rem; font-weight: bold; margin-top: 4px; color: #38bdf8;">+${(commonRes.totalSonicDmg || 0).toFixed(2)}%</div>
                        </div>
                    </div>

                    <!-- 스킬 요약 테이블 -->
                    <div style="font-size: 0.95rem; font-weight: bold; color: #e2e8f0; margin-bottom: 8px;">
                        [스킬별 시뮬레이션 결과 요약] <span style="font-size: 0.75em; font-weight: normal; color: #94a3b8;">(행 클릭 시 세부 내역 표시)</span>
                    </div>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
                            <thead>
                                <tr style="background-color: #181920; color: #94a3b8; border-bottom: 1px solid #2e323d;">
                                    <th style="padding: 10px;">스킬명</th>
                                    <th style="padding: 10px;">대미지 기대값</th>
                                    <th style="padding: 10px;">스킬 쿨타임</th>
                                </tr>
                            </thead>
                            <tbody>
        `;

        allSkillResults.forEach((res, idx) => {
            const isSelected = (idx === currentIdx);
            const rowStyle = isSelected
                ? 'background-color: #2d3142; cursor: pointer; border-bottom: 1px solid #2e323d;'
                : 'cursor: pointer; border-bottom: 1px solid #2e323d;';

            bodyContent += `
                <tr class="sim-skill-row" data-idx="${idx}" style="${rowStyle}">
                    <td style="padding: 10px; font-weight: bold; ${isSelected ? 'color: #38bdf8;' : 'color: #e2e8f0;'}">
                        ${res.skillName} ${isSelected ? '✔' : ''}
                    </td>
                    <td style="padding: 10px; color: #facc15; font-weight: bold;">${Math.floor(res.expDmg || 0).toLocaleString()}</td>
                    <td style="padding: 10px; color: #38bdf8;">${(res.finalCooldown || 0).toFixed(2)}초</td>
                </tr>
            `;
        });

        bodyContent += `
                            </tbody>
                        </table>
                    </div>
                </div>
            </details>
        `;

        // ----------------------------------------------------
        // 헬퍼 함수: 테이블 포맷터
        // ----------------------------------------------------
        const formatItemListToTable = (flatItems, percentItems, categoryNames = { flat: "[세부 항목]", percent: "[계수]" }) => {
            const hasFlat = Array.isArray(flatItems) && flatItems.length > 0;
            const hasPercent = Array.isArray(percentItems) && percentItems.length > 0;

            if (!hasFlat && !hasPercent) {
                return `<div style="color: #64748b; font-size: 0.8rem; padding: 6px 0;">내역 없음</div>`;
            }

            let html = `<table style="width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-top: 4px;"><tbody>`;

            if (hasFlat) {
                html += `
                    <tr>
                        <td colspan="2" style="padding: 6px 0 4px 0; color: #94a3b8; font-weight: bold; font-size: 0.8rem; border-bottom: 1px solid #2e323d;">
                            ${categoryNames.flat}
                        </td>
                    </tr>
                `;
                flatItems.forEach(item => {
                    const val = typeof item.val === 'number' ? item.val.toLocaleString() : item.val;
                    const src = item.source || '기본';
                    html += `
                        <tr>
                            <td style="padding: 5px 8px; color: #94a3b8; text-align: left; border-bottom: 1px solid #232733;">${src}</td>
                            <td style="padding: 5px 8px; color: #e2e8f0; font-weight: 500; text-align: right; border-bottom: 1px solid #232733;">+${val}</td>
                        </tr>
                    `;
                });
            }

            if (hasPercent) {
                if (hasFlat) html += `<tr><td colspan="2" style="padding: 6px 0;"></td></tr>`;
                html += `
                    <tr>
                        <td colspan="2" style="padding: 6px 0 4px 0; color: #38bdf8; font-weight: bold; font-size: 0.8rem; border-bottom: 1px solid #2e323d;">
                            ${categoryNames.percent}
                        </td>
                    </tr>
                `;
                percentItems.forEach(item => {
                    const val = (Number(item.val) || 0).toFixed(2);
                    const src = item.source || '옵션';
                    html += `
                        <tr>
                            <td style="padding: 5px 8px; color: #94a3b8; text-align: left; border-bottom: 1px solid #232733;">${src}</td>
                            <td style="padding: 5px 8px; color: #38bdf8; font-weight: 600; text-align: right; border-bottom: 1px solid #232733;">+${val}%</td>
                        </tr>
                    `;
                });
            }

            html += `</tbody></table>`;
            return html;
        };

        const stats = commonRes.stats || {};
        const finalStat = commonRes.finalStat || 0;
        const finalWeaponAtk = commonRes.finalWeaponAtk || 0;
        const calculatedBaseAtk = commonRes.calculatedBaseAtk || 0;
        const finalAtk = commonRes.finalAtk || 0;
        const carveAtkBonusPercent = commonRes.carveAtkBonusPercent || 0;
        const totalStoneLevel = commonRes.totalStoneLevel || 0;

        let vambracePercentList = [...(stats["기본 공격력 %"] || [])];
        if (carveAtkBonusPercent > 0) {
            vambracePercentList.push({ source: `세공 (${totalStoneLevel}LV)`, val: carveAtkBonusPercent });
        }

        // ----------------------------------------------------
        // [SECTION 2] 공격력 산출 과정
        // ----------------------------------------------------
        const sec2Open = window.sectionOpenStates.sec2 ? 'open' : '';
        const sec2Arrow = window.sectionOpenStates.sec2 ? '▼' : '▲';

        bodyContent += `
            <details data-sec-key="sec2" ${sec2Open} style="margin-bottom: 20px;">
                <summary style="${sectionHeaderStyle}">
                    <span>⚔️ [2. 공격력 산출 과정]</span>
                    <span class="toggle-icon" style="font-size: 0.8rem; color: #94a3b8;">${sec2Arrow}</span>
                </summary>
                <div style="padding-top: 16px; display: flex; flex-direction: column; gap: 14px; font-size: 0.9rem;">

                    <!-- 0. 주스탯 -->
                    <div style="background: #181920; border: 1px solid #2e323d; padding: 14px; border-radius: 8px;">
                        <div style="font-weight: 600; color: #c084fc; margin-bottom: 8px; font-size: 0.95rem;">0. 주스탯</div>
                        ${formatItemListToTable(stats["주스탯"], stats["주스탯 %"], { flat: "[주스탯 합산]", percent: "[주스탯 % 계수]" })}
                        <div style="text-align: right; font-weight: bold; color: #e2e8f0; margin-top: 10px; font-size: 0.95rem; border-top: 1px dashed #2e323d; padding-top: 8px;">
                            합계 = <span style="color: #38bdf8; font-size: 1.05rem;">${Math.floor(finalStat).toLocaleString()}</span>
                        </div>
                    </div>

                    <!-- 1. 최종 무기 공격력 -->
                    <div style="background: #181920; border: 1px solid #2e323d; padding: 14px; border-radius: 8px;">
                        <div style="font-weight: 600; color: #c084fc; margin-bottom: 8px; font-size: 0.95rem;">1. 최종 무기 공격력</div>
                        ${formatItemListToTable(stats["무기 공격력"], stats["무기 공격력 %"] || stats["무기 공격력%"], { flat: "[무기 공격력 합산]", percent: "[무기 공격력 % 계수]" })}
                        <div style="text-align: right; font-weight: bold; color: #e2e8f0; margin-top: 10px; font-size: 0.95rem; border-top: 1px dashed #2e323d; padding-top: 8px;">
                            합계 = <span style="color: #38bdf8; font-size: 1.05rem;">${Math.floor(finalWeaponAtk).toLocaleString()}</span>
                        </div>
                    </div>

                    <!-- 2. 기본 공격력 -->
                    <div style="background: #181920; border: 1px solid #2e323d; padding: 14px; border-radius: 8px;">
                        <div style="font-weight: 600; color: #c084fc; margin-bottom: 8px; font-size: 0.95rem;">2. 기본 공격력</div>
                        <div style="background: #0f1015; padding: 8px 12px; border-radius: 6px; border: 1px solid #222634; margin-bottom: 8px; font-size: 0.82rem; color: #cbd5e1;">
                            💡 <strong>공식:</strong> ( √(주스탯 ${Math.floor(finalStat).toLocaleString()} × 최종무공 ${Math.floor(finalWeaponAtk).toLocaleString()}) / 6 )*계수
                        </div>
                        ${formatItemListToTable(stats["기본 공격력"], vambracePercentList, { flat: "[기본 공격력 합산]", percent: "[기본 공격력 % 계수]" })}
                        <div style="text-align: right; font-weight: bold; color: #e2e8f0; margin-top: 10px; font-size: 0.95rem; border-top: 1px dashed #2e323d; padding-top: 8px;">
                            합계 = <span style="color: #38bdf8; font-size: 1.05rem;">${Math.floor(calculatedBaseAtk).toLocaleString()}</span>
                        </div>
                    </div>

                    <!-- 3. 최종 공격력 -->
                    <div style="background: #181920; border: 1px solid #2e323d; padding: 14px; border-radius: 8px;">
                        <div style="font-weight: 600; color: #c084fc; margin-bottom: 8px; font-size: 0.95rem;">3. 최종 공격력</div>
                        ${formatItemListToTable(stats["공격력"], stats["공격력 %"], { flat: "[공격력 합산]", percent: "[공격력 % 계수]" })}
                        <div style="text-align: right; font-weight: bold; color: #facc15; margin-top: 10px; font-size: 1.1rem; border-top: 1px dashed #2e323d; padding-top: 8px;">
                            최종 공격력 = ${Math.floor(finalAtk).toLocaleString()}
                        </div>
                    </div>

                </div>
            </details>
        `;

        // ----------------------------------------------------
        // [SECTION 3] 선택 스킬 상세 세팅 적용 내역
        // ----------------------------------------------------
        const selectedResult = allSkillResults[currentIdx] || allSkillResults[0];
        const sec3Open = window.sectionOpenStates.sec3 ? 'open' : '';
        const sec3Arrow = window.sectionOpenStates.sec3 ? '▼' : '▲';

        bodyContent += `
            <details data-sec-key="sec3" ${sec3Open} style="margin-bottom: 10px;">
                <summary style="${sectionHeaderStyle}">
                    <span>🎯 [3. 선택 스킬] <span style="color: #facc15;">${selectedResult.skillName}</span> 상세 세팅 내역</span>
                    <span class="toggle-icon" style="font-size: 0.8rem; color: #94a3b8;">${sec3Arrow}</span>
                </summary>
                <div style="padding-top: 16px;">
                    <div style="background: #181920; border: 1px solid #2e323d; padding: 16px; border-radius: 8px;">
        `;

        if (selectedResult.stats) {
            Object.keys(selectedResult.stats).forEach(cat => {
                if (cat.startsWith('_')) return;

                let items = selectedResult.stats[cat];

                bodyContent += `
                    <div style="margin-top: 14px;">
                        <div style="font-weight: bold; color: #c084fc; font-size: 0.85rem; border-bottom: 1px solid #2e323d; padding-bottom: 4px; margin-bottom: 4px;">
                            ■ ${cat}
                        </div>
                `;

                if (!items || items.length === 0) {
                    bodyContent += `<div style="font-size: 0.8rem; color: #64748b; padding: 4px 6px;">적용된 옵션 없음</div>`;
                } else {
                    items.sort((a, b) => {
                        const aSrc = String(a?.source || "");
                        const bSrc = String(b?.source || "");
                        return (aSrc.startsWith("각인:") ? 0 : 1) - (bSrc.startsWith("각인:") ? 0 : 1);
                    });

                    bodyContent += `<table style="width: 100%; border-collapse: collapse; font-size: 0.82rem;"><tbody>`;

                    items.forEach(item => {
                        const prefix = (typeof item.val === 'number' && item.val > 0) ? "+" : "";
                        const valStr = `${prefix}${item.val}${item.unit || ''}`;
                        const src = item.source || '옵션';

                        bodyContent += `
                            <tr>
                                <td style="padding: 5px 8px; color: #94a3b8; text-align: left; border-bottom: 1px solid #232733;">${src}</td>
                                <td style="padding: 5px 8px; color: #38bdf8; font-weight: 500; text-align: right; border-bottom: 1px solid #232733;">${valStr}</td>
                            </tr>
                        `;
                    });

                    bodyContent += `</tbody></table>`;
                }

                bodyContent += `</div>`;
            });
        }

        bodyContent += `
                    </div>
                </div>
            </details>
        `;

        /// ----------------------------------------------------
        // 결과 섹션 컨테이너 생성 및 배치 (클래스 부여로 너비 맞춤)
        // ----------------------------------------------------
        let resultSection = document.getElementById('sim-result-section');

        if (!resultSection) {
            resultSection = document.createElement('div');
            resultSection.id = 'sim-result-section';

            // 타겟: 세팅 비교 패널 바로 아래 (없으면 스킬&트라이포드 패널 아래)
            const targetModal = document.getElementById('sim-compare-dock') || document.getElementById('skillTripodModal');

            if (targetModal && targetModal.parentNode) {
                targetModal.parentNode.insertBefore(resultSection, targetModal.nextSibling);
            } else {
                document.body.appendChild(resultSection);
            }
        }

        // 💥 [핵심 수정] 상단 패널들과 동일한 custom-ark-panel 클래스를 부여합니다.
        resultSection.className = 'custom-ark-panel';

        // 패널 기본 디자인 + 상단 패널과의 간격(margin-top) 지정
        resultSection.style.cssText = `
            display: block !important;
            margin-top: 20px !important;
            background: #0f1015;
            color: #e2e8f0;
            border-radius: 12px;
            border: 1px solid #2e323d;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
            padding: 16px !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        resultSection.innerHTML = bodyContent;

        if (typeof injectPauseButton === 'function') {
            injectPauseButton();
        }

        // ----------------------------------------------------
        // 이벤트 바인딩 (스킬 클릭 & 토글 상태 기억)
        // ----------------------------------------------------
        resultSection.onclick = function(e) {
            const row = e.target.closest('.sim-skill-row');
            if (row) {
                const clickIdx = Number(row.getAttribute('data-idx'));
                if (!isNaN(clickIdx)) {
                    window.renderResultsHTML(window.lastSkillResults, clickIdx);
                }
            }
        };

        // 사용자가 직접 접거나 폈을 때 상태를 기억하는 이벤트 리스너
        resultSection.querySelectorAll('details').forEach(details => {
            details.ontoggle = function() {
                const secKey = this.getAttribute('data-sec-key');
                if (secKey) {
                    window.sectionOpenStates[secKey] = this.open;
                }
                const icon = this.querySelector('.toggle-icon');
                if (icon) {
                    icon.textContent = this.open ? '▼' : '▲';
                }
            };
        });

        // ----------------------------------------------------
        // 미니 모달 업데이트
        // ----------------------------------------------------
        try {
            const metricsGrid = resultSection.querySelector('details div[style*="grid"]');
            if (metricsGrid && typeof updateMiniResultModal === 'function') {
                updateMiniResultModal(metricsGrid.outerHTML);
            }
        } catch (err) {
            console.warn('미니 모달 업데이트 중 오류 발생:', err);
        }
    };

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.closeSimModal();
    });

    function initArkPassivePanel() {
        if (document.getElementById('arkPassiveModal')) return;

        const panelHtml = `
            <div id="arkPassiveModal" class="custom-ark-panel">
                <div id="arkEvolutionContainer"></div>
            </div>
        `;

        // 💡 main 등을 찾지 말고, React 루트 영역 밖인 document.body에 직접 붙입니다.
        document.body.insertAdjacentHTML('beforeend', panelHtml);

        const style = document.createElement('style');
        style.innerHTML = `
        .custom-ark-panel {
            /* 💡 원본 사이트의 CSS 변수 및 정렬 속성 그대로 적용 */
            width: var(--main-width) !important;
            min-width: var(--main-width) !important;
            margin-left: auto !important;
            margin-right: auto !important;
            margin-top: 20px !important;
            margin-bottom: 20px !important;
            box-sizing: border-box !important;

            /* 커스텀 디자인 유지 */
            background: #18181c;
            border: 1px solid #2a2a32;
            border-radius: 12px;
            padding: 20px;
            color: #e1e1e6;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            font-size: 12px;
            font-family: sans-serif;
            clear: both;
        }
        `;
        document.head.appendChild(style);

        renderArkPassiveUI();
    }

    // 전역 변수로 아크 패시브 영역의 열림 상태 기억 (기본값: true)
    if (window.isArkPassiveOpen === undefined) {
        window.isArkPassiveOpen = true;
    }

    function renderArkPassiveUI() {
        const container = document.getElementById('arkEvolutionContainer');
        if (!container) return;

        container.innerHTML = '';

        // ----------------------------------------------------
        // 헤더 스타일 (계산 출력 섹션과 동일한 스타일 적용)
        // ----------------------------------------------------
        const sectionHeaderStyle = makeSectionHeaderStyle('#c084fc');

        // 1. details / summary 아코디언 요소 생성
        const details = document.createElement('details');
        details.style.marginBottom = '20px';
        if (window.isArkPassiveOpen) {
            details.setAttribute('open', '');
        }

        const arrow = window.isArkPassiveOpen ? '▼' : '▲';
        details.innerHTML = `
            <summary style="${sectionHeaderStyle}">
                <span>✨ [아크 패시브 - 진화] 세팅</span>
                <span class="toggle-icon" style="font-size: 0.8rem; color: #94a3b8;">${arrow}</span>
            </summary>
        `;

        // 상태 기억을 위한 ontoggle 이벤트
        details.ontoggle = function() {
            window.isArkPassiveOpen = this.open;
            const icon = this.querySelector('.toggle-icon');
            if (icon) {
                icon.textContent = this.open ? '▼' : '▲';
            }
        };

        // 2. 노드들이 들어갈 내부 컨테이너 생성
        // 💥 [수정 포인트] 세로 간격을 유지하도록 flex 및 gap 추가
        const contentDiv = document.createElement('div');
        contentDiv.style.cssText = `
            padding-top: 16px;
            display: flex;
            flex-direction: column;
            gap: 30px; /* 행 간의 세로 간격을 넓혀줍니다 */
        `;

        // 3. 기존 노드 렌더링 로직 (contentDiv 안으로 배치)
        evolutionNodes.forEach((row, rowIndex) => {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'ark-row';
            const maxRowLimit = rowMaxLimits[rowIndex];

            row.forEach((node) => {
                const nodeDiv = document.createElement('div');
                nodeDiv.className = 'ark-node';

                const currentRowTotal = row.reduce((sum, n) => sum + n.current, 0);
                nodeDiv.title = `${node.name} (현재: ${node.current}/${node.max} | 라인 합계: ${currentRowTotal}/${maxRowLimit})`;

                const isGrayscale = node.current === 0 ? 'grayscale' : '';

                nodeDiv.innerHTML = `
                    <span style="font-size: 11px; margin-bottom: 4px; color: #c9d1d9;">${node.name}</span>
                    <img src="https://cdn-lostark.game.onstove.com/efui_iconatlas/ark_passive_evolution/ark_passive_evolution_${node.id}.png" class="ark-icon ${isGrayscale}" alt="${node.name}" width="40" height="40">
                    <div class="node-controls">
                        <button type="button" class="btn-node btn-dec">-</button>
                        <span style="min-width: 36px; text-align: center; color: #58a6ff;">${node.current}/${node.max}</span>
                        <button type="button" class="btn-node btn-inc">+</button>
                    </div>
                `;

                const changeValue = (delta) => {
                    let targetValue = node.current + delta;
                    if (targetValue < 0) targetValue = 0;
                    if (targetValue > node.max) targetValue = node.max;

                    const otherNodesSum = row.reduce((sum, n) => (n === node ? sum : sum + n.current), 0);
                    if (otherNodesSum + targetValue > maxRowLimit) {
                        targetValue = maxRowLimit - otherNodesSum;
                        if (targetValue < 0) targetValue = 0;
                        if (targetValue > node.max) targetValue = node.max;
                    }

                    if (node.current !== targetValue) {
                        node.current = targetValue;
                        renderArkPassiveUI();
                    }
                };

                const decBtn = nodeDiv.querySelector('.btn-dec');
                const incBtn = nodeDiv.querySelector('.btn-inc');
                const iconImg = nodeDiv.querySelector('.ark-icon');

                const handleNodeChange = (delta, e) => {
                    e.stopPropagation();
                    changeValue(delta);
                    if (typeof saveArkPassive === 'function') saveArkPassive();
                    if (typeof window.triggerCalculation === 'function') window.triggerCalculation();
                };

                decBtn.onclick = (e) => handleNodeChange(e.shiftKey ? -10 : -1, e);
                incBtn.onclick = (e) => handleNodeChange(e.shiftKey ? 10 : 1, e);
                iconImg.onclick = (e) => handleNodeChange(e.shiftKey ? 10 : 1, e);
                iconImg.oncontextmenu = (e) => {
                    e.preventDefault();
                    handleNodeChange(e.shiftKey ? -10 : -1, e);
                };

                rowDiv.appendChild(nodeDiv);
            });

            contentDiv.appendChild(rowDiv);
        });

        details.appendChild(contentDiv);
        container.appendChild(details);
    }


    // 🌟 1. 스킬 & 트라이포드 패널 초기화 및 스타일 주입 함수
    function initSkillTripodPanel() {
        if (document.getElementById('skillTripodModal')) return;

        // 아크패시브 패널 찾기
        const arkPanel = document.getElementById('arkPassiveModal');

        const panelHtml = `
            <div id="skillTripodModal" class="custom-ark-panel">
                <div id="skillTripodContainer"></div>
            </div>
        `;

        if (arkPanel) {
            // 💡 아크 패시브 모달 바로 다음(afterend)에 위치시킵니다.
            arkPanel.insertAdjacentHTML('afterend', panelHtml);
        } else {
            // 만약 아크 패시브 모달이 없으면 body 맨 뒤에 배치
            document.body.insertAdjacentHTML('beforeend', panelHtml);
        }

        renderSkillTripodUI();
    }

    // 🌟 2. 스킬 & 트라이포드 UI 렌더링 함수
    function renderSkillTripodUI() {
        const container = document.getElementById('skillTripodContainer');
        if (!container) return;

        container.innerHTML = '';

        // 데이터 로드
        const renderData = window.skillDatabase || {};
        if (Object.keys(renderData).length === 0) {
            container.innerHTML = `<div style="text-align: center; color: #64748b; padding: 20px;">등록된 스킬 데이터가 없습니다. (데이터 관리 모달에서 DB를 확인해주세요)</div>`;
            return;
        }

        // [수정 후] undefined/null 인 경우에만 localStorage에서 로드
        if (window.selectedSkillTripods === undefined || window.selectedSkillTripods === null) {
            try {
                const saved = localStorage.getItem('LOSTARK_SELECTED_TRIPODS');
                if (saved) window.selectedSkillTripods = JSON.parse(saved);
            } catch (e) {
                console.error('트라이포드 로컬 저장소 로드 실패:', e);
            }
        }
        window.selectedSkillTripods = window.selectedSkillTripods || {};

        // ----------------------------------------------------
        // 아크패시브와 동일한 아코디언 헤더 스타일
        // ----------------------------------------------------
        const sectionHeaderStyle = makeSectionHeaderStyle('#38bdf8');

        // ----------------------------------------------------
        // 아코디언 상태 로드 (기본값: true - 최초 접속 시 펼침)
        // ----------------------------------------------------
        if (window.isSkillTripodOpen === undefined) {
            try {
                const savedOpen = localStorage.getItem('LOSTARK_SKILL_TRIPOD_OPEN');
                // 저장된 값이 없으면 기본적으로 open(true) 상태 유지
                window.isSkillTripodOpen = savedOpen !== null ? JSON.parse(savedOpen) : true;
            } catch (e) {
                window.isSkillTripodOpen = true;
            }
        }

        const details = document.createElement('details');
        details.style.marginBottom = '0px';

        // isSkillTripodOpen이 true면 open 속성 부여
        if (window.isSkillTripodOpen) {
            details.setAttribute('open', '');
        }

        const arrow = window.isSkillTripodOpen ? '▼' : '▲';

        details.innerHTML = `
            <summary style="${sectionHeaderStyle}">
                <span>⚡ [스킬 & 트라이포드] 세팅</span>
                <span class="toggle-icon" style="font-size: 0.8rem; color: #94a3b8;">${arrow}</span>
            </summary>
        `;

        // 토글 동작 시 window 변수 및 localStorage에 상태 저장
        details.ontoggle = function() {
            window.isSkillTripodOpen = this.open;
            try {
                localStorage.setItem('LOSTARK_SKILL_TRIPOD_OPEN', JSON.stringify(this.open));
            } catch (e) {}

            const icon = this.querySelector('.toggle-icon');
            if (icon) {
                icon.textContent = this.open ? '▼' : '▲';
            }
        };

        const contentDiv = document.createElement('div');
        contentDiv.style.cssText = `
            padding-top: 16px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        `;

        // 🧹 전체 초기화 헤더
        const globalResetHeader = document.createElement('div');
        globalResetHeader.style.cssText = `
            display: flex; justify-content: space-between; align-items: center;
            background: #0f172a; border: 1px solid rgba(255, 255, 255, 0.15);
            padding: 10px 14px; border-radius: 8px;
        `;
        globalResetHeader.innerHTML = `
            <span style="font-size: 0.85rem; color: #cbd5e1; font-weight: bold;">🔱 트라이포드 커스텀 선택</span>
            <button id="btn-reset-all-tripods-main" style="
                background: #dc2626; color: #ffffff; border: none; padding: 6px 12px;
                border-radius: 6px; font-size: 0.75rem; font-weight: bold; cursor: pointer;
            ">🧹 전체 트라이포드 초기화</button>
        `;
        contentDiv.appendChild(globalResetHeader);

        globalResetHeader.querySelector('#btn-reset-all-tripods-main').onclick = () => {
            if (confirm('모든 스킬의 선택된 트라이포드를 초기화하시겠습니까?')) {
                window.selectedSkillTripods = {};
                try { localStorage.removeItem('LOSTARK_SELECTED_TRIPODS'); } catch (e) {}
                renderSkillTripodUI();
                if (typeof window.updateSelectedTripodsAndCalculate === 'function') {
                    window.updateSelectedTripodsAndCalculate();
                }
            }
        };

        // 2열 반응형 그리드
        const cardGrid = document.createElement('div');
        cardGrid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
            gap: 16px;
        `;

        // 각 스킬 카드 생성
        Object.entries(renderData).forEach(([skillKey, skill]) => {
            const skillIdentifier = skill.name || skillKey;
            const tagList = Array.isArray(skill.tags) ? skill.tags : (skill.tags || '').split(',').map(t => t.trim()).filter(Boolean);
            const tagBadges = tagList.map(t => `<span style="background: #334155; color: #38bdf8; padding: 2px 8px; border-radius: 12px; font-size: 0.72rem; border: 1px solid rgba(56, 189, 248, 0.2);">#${t}</span>`).join('');

            let tripodsHtml = '';
            if (skill.tripods && Array.isArray(skill.tripods) && skill.tripods.length > 0) {
                const groupedByTier = skill.tripods.reduce((acc, tripod) => {
                    const tier = tripod.tier || 1;
                    if (!acc[tier]) acc[tier] = [];
                    acc[tier].push(tripod);
                    return acc;
                }, {});

                const sortedTiers = Object.keys(groupedByTier).sort((a, b) => Number(a) - Number(b));

                tripodsHtml = sortedTiers.map(tier => {
                    const tierTripods = groupedByTier[tier];

                    const optionsHtml = tierTripods.map((t) => {
                        const savedTripodName = window.selectedSkillTripods[skillIdentifier]?.[tier]
                                            || window.selectedSkillTripods[skillKey]?.[tier];
                        const isChecked = (savedTripodName === t.name);

                        const effectsHtml = (t.effects || []).map(e => {
                            const val = e.value ?? e.val ?? 0;
                            const sign = val > 0 ? '+' : '';
                            return `<span style="color: #4ade80; font-weight: bold;">${e.category || e.type || '효과'} ${sign}${val}${e.unit || ''}</span>`;
                        }).join(', ');

                        return `
                            <label class="tripod-radio-card" style="
                                display: flex; align-items: center; justify-content: space-between;
                                background: ${isChecked ? '#1e3a8a' : '#0f172a'};
                                border: 1px solid ${isChecked ? '#60a5fa' : 'rgba(255, 255, 255, 0.08)'};
                                padding: 8px 12px; border-radius: 6px; cursor: pointer;
                                transition: all 0.15s ease;
                            ">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <input type="radio"
                                        name="main_tripod_${skillIdentifier}_tier_${tier}"
                                        value="${t.name}"
                                        data-skill-name="${skillIdentifier}"
                                        data-skill-key="${skillKey}"
                                        data-tier="${tier}"
                                        data-name="${t.name}"
                                        ${isChecked ? 'checked' : ''}
                                        style="accent-color: #38bdf8; cursor: pointer;">
                                    <span style="font-size: 0.85rem; font-weight: bold; color: ${isChecked ? '#60a5fa' : '#f8fafc'};">${t.name}</span>
                                </div>
                                <div style="font-size: 0.78rem;">${effectsHtml}</div>
                            </label>
                        `;
                    }).join('');

                    return `
                        <div style="background: #182234; border-left: 3px solid #2563eb; border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-size: 0.8rem; font-weight: bold; color: #60a5fa;">🔱 ${tier}티어 선택</span>
                                <button class="btn-clear-tier-main" data-skill="${skillIdentifier}" data-skill-key="${skillKey}" data-tier="${tier}" style="
                                    background: none; border: none; color: #94a3b8; font-size: 0.72rem; cursor: pointer; text-decoration: underline;
                                ">선택 해제</button>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 6px;">${optionsHtml}</div>
                        </div>
                    `;
                }).join('');
            } else {
                tripodsHtml = `<div style="font-size: 0.75rem; color: #64748b; font-style: italic;">설정된 트라이포드가 없습니다.</div>`;
            }

            const card = document.createElement('div');
            card.className = 'skill-card-item';
            card.style.cssText = `background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 12px;`;
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">
                    <span style="font-size: 1rem; font-weight: bold; color: #f8fafc;">⚡ ${skillIdentifier}</span>
                    <button class="btn-reset-skill-tripods-main" data-skill-name="${skillIdentifier}" data-skill-key="${skillKey}" style="
                        background: #334155; color: #cbd5e1; border: 1px solid rgba(255,255,255,0.1);
                        padding: 4px 8px; border-radius: 4px; font-size: 0.72rem; cursor: pointer;
                    ">🔄 해당 스킬 초기화</button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;">
                    <div style="background: #0f172a; padding: 6px; border-radius: 6px; text-align: center;"><div style="font-size: 0.65rem; color: #94a3b8;">상수</div><div style="font-size: 0.8rem; font-weight: bold;">${skill.constant ?? '-'}</div></div>
                    <div style="background: #0f172a; padding: 6px; border-radius: 6px; text-align: center;"><div style="font-size: 0.65rem; color: #94a3b8;">계수</div><div style="font-size: 0.8rem; font-weight: bold;">${skill.coefficient ?? '-'}</div></div>
                    <div style="background: #0f172a; padding: 6px; border-radius: 6px; text-align: center;"><div style="font-size: 0.65rem; color: #94a3b8;">쿨타임</div><div style="font-size: 0.8rem; font-weight: bold;">${skill.baseCooldown ?? '-'}s</div></div>
                    <div style="background: #0f172a; padding: 6px; border-radius: 6px; text-align: center;"><div style="font-size: 0.65rem; color: #94a3b8;">마나</div><div style="font-size: 0.8rem; font-weight: bold;">${skill.mana ?? skill.baseMana ?? 0}</div></div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;"><div style="display: flex; flex-wrap: wrap; gap: 4px;">${tagBadges}</div></div>
                <div style="display: flex; flex-direction: column; gap: 8px;">${tripodsHtml}</div>
            `;

            cardGrid.appendChild(card);
        });

        contentDiv.appendChild(cardGrid);
        details.appendChild(contentDiv);
        container.appendChild(details);

        // 클릭 핸들러
        contentDiv.onclick = (e) => {
            const rawTarget = e.target;
            if (!rawTarget) return;

            const resetBtn = rawTarget.closest('.btn-reset-skill-tripods-main');
            const clearTierBtn = rawTarget.closest('.btn-clear-tier-main');

            if (resetBtn) {
                const skillName = resetBtn.getAttribute('data-skill-name');
                const skillKey = resetBtn.getAttribute('data-skill-key');

                if (window.selectedSkillTripods) {
                    if (skillName) delete window.selectedSkillTripods[skillName];
                    if (skillKey) delete window.selectedSkillTripods[skillKey];
                }
                renderSkillTripodUI();
                if (typeof window.updateSelectedTripodsAndCalculate === 'function') {
                    window.updateSelectedTripodsAndCalculate();
                }
                return;
            }

            if (rawTarget.type === 'radio') {
                const skillName = rawTarget.getAttribute('data-skill-name');
                const tier = rawTarget.getAttribute('data-tier');
                const tripodName = rawTarget.getAttribute('data-name');

                if (!window.selectedSkillTripods[skillName]) {
                    window.selectedSkillTripods[skillName] = {};
                }
                window.selectedSkillTripods[skillName][tier] = tripodName;

                const parentTierContainer = rawTarget.closest('div[style*="flex-direction: column"]');
                if (parentTierContainer) {
                    const labels = parentTierContainer.querySelectorAll('.tripod-radio-card');
                    labels.forEach(label => {
                        const radio = label.querySelector('input[type="radio"]');
                        const textSpan = label.querySelector('span');
                        if (radio.checked) {
                            label.style.background = '#1e3a8a';
                            label.style.borderColor = '#60a5fa';
                            if (textSpan) textSpan.style.color = '#60a5fa';
                        } else {
                            label.style.background = '#0f172a';
                            label.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                            if (textSpan) textSpan.style.color = '#f8fafc';
                        }
                    });
                }
            }

            if (clearTierBtn) {
                const skillName = clearTierBtn.getAttribute('data-skill');
                const skillKey = clearTierBtn.getAttribute('data-skill-key');
                const tier = clearTierBtn.getAttribute('data-tier');

                if (window.selectedSkillTripods) {
                    if (window.selectedSkillTripods[skillName]) delete window.selectedSkillTripods[skillName][tier];
                    if (window.selectedSkillTripods[skillKey]) delete window.selectedSkillTripods[skillKey][tier];
                }
                renderSkillTripodUI();
            }

            if (rawTarget.type === 'radio' || clearTierBtn) {
                if (typeof window.updateSelectedTripodsAndCalculate === 'function') {
                    window.updateSelectedTripodsAndCalculate();
                }
            }
        };
    }


    // ==========================================
    // 실시간 계산 일시정지 토글 버튼 로직
    // ==========================================
    window.toggleCalcPause = function() {
        window.isCalcPaused = !window.isCalcPaused;

        const btn = document.getElementById('calc-pause-btn');
        if (!btn) return;

        if (window.isCalcPaused) {
            btn.innerText = '⏸️ 실시간 계산 : OFF';
            btn.style.backgroundColor = '#ef4444';
            btn.style.borderColor = '#f87171';
        } else {
            btn.innerText = '▶️ 실시간 계산 : ON';
            btn.style.backgroundColor = '#22c55e';
            btn.style.borderColor = '#4ade80';

            if (typeof window.triggerCalculation === 'function') {
                window.triggerCalculation();
            }
        }
    };

    // 비교군 설정 저장
    window.setBaseline = function() {
        if (!lastCalculatedResults || lastCalculatedResults.length === 0) {
            showAlert('비교군으로 설정할 계산 결과가 없습니다.');
            return;
        }
        // 1) 메모리 상의 변수에 저장
        baselineResults = JSON.parse(JSON.stringify(lastCalculatedResults));

        // 2) 로컬 스토리지에 JSON 문자열 형태로 영구 저장
        try {
            localStorage.setItem('savedBaselineResults', JSON.stringify(baselineResults));
        } catch (e) {
            console.error('로컬스토리지 저장 실패:', e);
        }

        renderCompareTable();
        showAlert('현재 세팅 결과가 비교군으로 설정되었습니다!');
    };


    /**
     * 비교 테이블 렌더링 함수
     */
    let compareView = 'chart';   // 'chart' | 'table'
    let compareMetric = 'dmg';   // 'dmg' | 'dps' | 'cd'

    // 스킬별 비교 수치 (그래프/표 공용)
    function buildCompareRows() {
        return lastCalculatedResults.map((curr, idx) => {
            const base = baselineResults.find(b => b.skillName === curr.skillName) || baselineResults[idx];
            if (!base) return null;
            const baseDmg = base.expDmg || 0, currDmg = curr.expDmg || 0;
            const baseCd = base.finalCooldown || 0.001, currCd = curr.finalCooldown || 0.001;
            const baseDps = baseDmg / baseCd, currDps = currDmg / currCd;
            const pct = (a, b) => a > 0 ? ((b - a) / a) * 100 : 0;
            return { name: curr.skillName, baseDmg, currDmg, baseCd, currCd, baseDps, currDps,
                     dmgPct: pct(baseDmg, currDmg), cdPct: pct(baseCd, currCd), dpsPct: pct(baseDps, currDps) };
        }).filter(Boolean);
    }

    function renderCompareChart(chartEl) {
        const rows = buildCompareRows();
        const M = {
            dmg: { b: r => r.baseDmg, c: r => r.currDmg, p: r => r.dmgPct, good: p => p > 0 },
            dps: { b: r => r.baseDps, c: r => r.currDps, p: r => r.dpsPct, good: p => p > 0 },
            cd:  { b: r => r.baseCd,  c: r => r.currCd,  p: r => r.cdPct,  good: p => p < 0 }
        }[compareMetric];
        const max = Math.max(...rows.map(r => Math.max(M.b(r), M.c(r))), 1e-9);
        const esc = t => String(t).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
        const PLOT_H = 220; // 막대 최대 높이(px)
        chartEl.innerHTML = `<div class="cmp-plot">` + rows.map((r, i) => {
            const p = M.p(r);
            const cls = p === 0 ? 'zero' : (M.good(p) ? 'pos' : 'neg');
            return `<div class="cmp-col" data-i="${i}">
                <div class="cmp-diff ${cls}">${p > 0 ? '+' : ''}${p.toFixed(1)}%</div>
                <div class="cmp-pair">
                    <div class="cmp-bar base" style="height:${(M.b(r) / max * PLOT_H).toFixed(1)}px"></div>
                    <div class="cmp-bar curr" style="height:${(M.c(r) / max * PLOT_H).toFixed(1)}px"></div>
                </div>
            </div>`;
        }).join('') + `</div><div class="cmp-labels">` +
        rows.map(r => `<div class="cmp-name" title="${esc(r.name)}">${esc(r.name)}</div>`).join('') +
        `</div><div id="cmp-tooltip"></div>`;

        const tip = chartEl.querySelector('#cmp-tooltip');
        const sg = v => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
        const show = (col) => {
            const r = rows[+col.dataset.i];
            tip.innerHTML = `<b style="color:#fff">${esc(r.name)}</b><br>
                <span style="color:#a78bfa">비교군</span> 기대값 ${Math.floor(r.baseDmg).toLocaleString()} · 쿨 ${r.baseCd.toFixed(2)}s · DPS ${Math.floor(r.baseDps).toLocaleString()}<br>
                <span style="color:#38bdf8">지금</span> 기대값 ${Math.floor(r.currDmg).toLocaleString()} · 쿨 ${r.currCd.toFixed(2)}s · DPS ${Math.floor(r.currDps).toLocaleString()}<br>
                데미지 ${sg(r.dmgPct)} / 쿨타임 ${sg(r.cdPct)} / DPS ${sg(r.dpsPct)}`;
            tip.style.display = 'block';
            // 막대 묶음 위쪽에 배치, 차트 영역 안으로 가로 보정
            const box = chartEl.getBoundingClientRect();
            const pair = col.querySelector('.cmp-pair').getBoundingClientRect();
            const w = tip.offsetWidth, h = tip.offsetHeight;
            let left = pair.left + pair.width / 2 - box.left - w / 2;
            left = Math.max(0, Math.min(left, box.width - w));
            let top = pair.top - box.top - h - 8;
            if (top < 0) top = pair.bottom - box.top + 8; // 위 공간이 없으면 아래로
            top = Math.min(top, box.height - h);
            tip.style.left = left + 'px';
            tip.style.top = Math.max(0, top) + 'px';
        };
        chartEl.onmouseover = (e) => { const c = e.target.closest('.cmp-col'); if (c) show(c); else tip.style.display = 'none'; };
        chartEl.onmouseleave = () => { tip.style.display = 'none'; };
    }

    function renderCompareTable() {
        const tbody = document.getElementById('compareTableBody');
        if (!tbody) return;

        // 보기/지표 전환 상태 반영
        const chartEl = document.getElementById('compareChart');
        const wrapEl = document.getElementById('compareTableWrapper');
        document.querySelectorAll('#cmp-view-seg button').forEach(b => b.classList.toggle('on', b.dataset.view === compareView));
        document.querySelectorAll('#cmp-metric-seg button').forEach(b => b.classList.toggle('on', b.dataset.metric === compareMetric));
        const metricSeg = document.getElementById('cmp-metric-seg');
        if (metricSeg) metricSeg.style.display = compareView === 'chart' ? 'inline-flex' : 'none';
        const hasData = !!(baselineResults && lastCalculatedResults);
        if (chartEl) chartEl.style.display = (compareView === 'chart' && hasData) ? 'block' : 'none';
        if (wrapEl) wrapEl.style.display = (compareView === 'table' || !hasData) ? 'block' : 'none';
        if (hasData && compareView === 'chart' && chartEl) renderCompareChart(chartEl);

        if (!baselineResults || !lastCalculatedResults) {
            tbody.innerHTML = '<tr><td colspan="8" style="padding: 30px; color: #a1a1aa;">비교할 세팅 데이터가 없습니다.<br>플로팅 메뉴의 <b>[📌 비교군 저장]</b> 버튼을 먼저 눌러주세요.</td></tr>';
            return;
        }

        let html = '';

        lastCalculatedResults.forEach((curr, idx) => {
            const base = baselineResults.find(b => b.skillName === curr.skillName) || baselineResults[idx];
            if (!base) return;

            // 수치 추출
            const baseDmg = base.expDmg || 0;
            const currDmg = curr.expDmg || 0;
            const dmgDiffPercent = baseDmg > 0 ? ((currDmg - baseDmg) / baseDmg) * 100 : 0;

            const baseCd = base.finalCooldown || 0.001;
            const currCd = curr.finalCooldown || 0.001;
            const cdDiffPercent = baseCd > 0 ? ((currCd - baseCd) / baseCd) * 100 : 0;

            const baseDps = baseCd > 0 ? baseDmg / baseCd : 0;
            const currDps = currCd > 0 ? currDmg / currCd : 0;
            const dpsDiffPercent = baseDps > 0 ? ((currDps - baseDps) / baseDps) * 100 : 0;

            // 클래스 판별 (이득 = pos, 손해 = neg)
            // 데미지/DPS: +가 이득(pos), -가 손해(neg)
            const getDmgClass = (val) => val > 0 ? 'pos' : (val < 0 ? 'neg' : 'zero');
            // 쿨타임: -가 감소(이득: pos), +가 증가(손해: neg)
            const getCdClass = (val) => val < 0 ? 'pos' : (val > 0 ? 'neg' : 'zero');

            html += `
                <tr>
                    <td class="skill-name">${curr.skillName}</td>
                    <td>${Math.floor(baseDmg).toLocaleString()}</td>
                    <td>${baseCd.toFixed(2)}s</td>
                    <td>${Math.floor(currDmg).toLocaleString()}</td>
                    <td>${currCd.toFixed(2)}s</td>
                    <td class="${getDmgClass(dmgDiffPercent)}">${dmgDiffPercent > 0 ? '+' : ''}${dmgDiffPercent.toFixed(2)}%</td>
                    <td class="${getCdClass(cdDiffPercent)}">${cdDiffPercent > 0 ? '+' : ''}${cdDiffPercent.toFixed(2)}%</td>
                    <td class="${getDmgClass(dpsDiffPercent)}">${dpsDiffPercent > 0 ? '+' : ''}${dpsDiffPercent.toFixed(2)}%</td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    }

    // 전역 변수로 partyCritCount 관리 (기본값: 0)
    window.partyCritCount = 0;






    // 에스더 UI
    window.updateEstherUI = function(isEsther) {
        const estherBox = document.getElementById('esther-bonding-box');
        const btn1 = document.getElementById('esther-bonding-btn-1');
        const btn2 = document.getElementById('esther-bonding-btn-2');

        if (!estherBox || !btn1 || !btn2) return;

        if (isEsther) {
            // 에스더 무기 장착 시
            btn1.disabled = false;
            btn2.disabled = false;
            estherBox.style.opacity = '1';
            estherBox.style.pointerEvents = 'auto';
        } else {
            // 일반 무기 장착 시 OFF 초기화 및 disabled
            window.estherBonding1 = false;
            window.estherBonding2 = false;

            // 버튼 텍스트 및 스타일 OFF로 강제 변경
            btn1.innerText = '💤 결속 1단계 : OFF';
            btn1.style.backgroundColor = '#0f172a';
            btn1.style.borderColor = 'rgba(255, 255, 255, 0.15)';
            btn1.style.color = '#94a3b8';

            btn2.innerText = '💤 결속 2단계 : OFF';
            btn2.style.backgroundColor = '#0f172a';
            btn2.style.borderColor = 'rgba(255, 255, 255, 0.15)';
            btn2.style.color = '#94a3b8';

            btn1.disabled = true;
            btn2.disabled = true;
            estherBox.style.opacity = '0.4';
            estherBox.style.pointerEvents = 'none';
        }
    };


    // 💡 스크립트 로드 즉시 (또는 DOM 준비 후) 플로팅 패널을 먼저 그려줍니다!
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (typeof injectPauseButton === 'function') injectPauseButton();
        });
    } else {
        if (typeof injectPauseButton === 'function') injectPauseButton();
    }

    // -------------------------------------------------------------
    // 🌟 UI에서 선택된 트라이포드 데이터를 수집하여 계산으로 전달하는 전역 함수
    // -------------------------------------------------------------
    // 🌟 트라이포드 선택 상태를 저장하고 계산을 트리거하는 핵심 함수
    window.updateSelectedTripodsAndCalculate = function() {
        // 1. localStorage에 선택된 트라이포드 저장
        try {
            localStorage.setItem('LOSTARK_SELECTED_TRIPODS', JSON.stringify(window.selectedSkillTripods || {}));
        } catch (e) {
            console.error('트라이포드 저장 실패:', e);
        }

        // 2. 만약 계산 로직 실행 함수(예: calculateAll, runCalculation 등)가 존재하면 실행
        if (typeof window.calculateAll === 'function') {
            window.calculateAll();
        } else if (typeof window.runCalculation === 'function') {
            window.runCalculation();
        }
    };

    // 🌟 [중요] 계산 엔진에서 스킬 데미지를 계산할 때 트라이포드 효과를 합산하는 헬퍼 함수
    // (계산 함수 내부에서 스킬별 트라이포드 수치를 가져올 때 이 함수를 사용하도록 연결해야 합니다)
    window.getAppliedTripodEffects = function(skillIdentifier) {
        const selected = window.selectedSkillTripods?.[skillIdentifier] || {};
        const skillData = window.skillDatabase?.[skillIdentifier];
        if (!skillData || !skillData.tripods) return [];

        const activeEffects = [];

        // 선택된 1, 2, 3티어 트라이포드의 효과 추출
        Object.entries(selected).forEach(([tier, tripodName]) => {
            const foundTripod = skillData.tripods.find(t => String(t.tier) === String(tier) && t.name === tripodName);
            if (foundTripod && foundTripod.effects) {
                activeEffects.push(...foundTripod.effects);
            }
        });

        return activeEffects;
    };

    /// =========================================================================
    // 1. [신규] DB 데이터 통합 프리셋 관리 모달
    // =========================================================================
    function openDataPresetModal() {
        if (document.getElementById('data-preset-modal')) return;

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'data-preset-modal';
        modalOverlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.75);
            z-index: 99999999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: #1e293b;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 12px;
            padding: 20px;
            width: 420px;
            color: #f8fafc;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.6);
            display: flex;
            flex-direction: column;
            gap: 16px;
        `;

        modal.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
                <h3 style="margin: 0; font-size: 1.1rem; color: #38bdf8;">📦 DB 데이터 프리셋 관리</h3>
                <span id="close-preset-modal" style="cursor: pointer; font-size: 1.2rem; color: #94a3b8;">&times;</span>
            </div>

            <div style="background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; gap: 8px;">
                <label style="font-size: 0.8rem; font-weight: bold; color: #e2e8f0;">현재 데이터 및 트라이포드 세팅을 프리셋으로 저장</label>
                <div style="display: flex; gap: 6px;">
                    <input type="text" id="db-preset-name-input" placeholder="프리셋 이름 (예: 점핑캐릭 세팅 1)" style="
                        flex: 1; background: #1e293b; border: 1px solid rgba(255,255,255,0.15); color: #fff;
                        padding: 6px 10px; border-radius: 6px; font-size: 0.8rem; outline: none;
                    ">
                    <button id="btn-save-db-preset" style="
                        background: #2563eb; color: #fff; border: none; padding: 6px 12px;
                        font-size: 0.78rem; font-weight: bold; border-radius: 6px; cursor: pointer;
                    ">저장</button>
                </div>
            </div>

            <div style="background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; gap: 8px;">
                <label style="font-size: 0.8rem; font-weight: bold; color: #e2e8f0;">저장된 DB 프리셋 불러오기</label>
                <select id="db-preset-select" style="
                    width: 100%; background: #1e293b; color: #fff; border: 1px solid rgba(255,255,255,0.15);
                    padding: 8px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; outline: none;
                ">
                    <option value="">-- 프리셋을 선택하세요 --</option>
                </select>
                <div style="display: flex; gap: 6px; margin-top: 4px;">
                    <button id="btn-load-db-preset" style="
                        flex: 1; background: #059669; color: #fff; border: none; padding: 8px;
                        font-size: 0.78rem; font-weight: bold; border-radius: 6px; cursor: pointer;
                    ">불러오기 및 적용</button>
                    <button id="btn-delete-db-preset" style="
                        background: #dc2626; color: #fff; border: none; padding: 8px 12px;
                        font-size: 0.78rem; font-weight: bold; border-radius: 6px; cursor: pointer;
                    ">삭제</button>
                </div>
            </div>

            <div style="display: flex; gap: 6px; pt: 4px;">
                <button id="btn-export-db-presets" style="
                    flex: 1; background: #334155; color: #cbd5e1; border: 1px solid rgba(255,255,255,0.1);
                    padding: 6px; font-size: 0.72rem; border-radius: 6px; cursor: pointer;
                ">📤 백업(JSON 다운로드)</button>
                <button id="btn-import-db-presets" style="
                    flex: 1; background: #334155; color: #cbd5e1; border: 1px solid rgba(255,255,255,0.1);
                    padding: 6px; font-size: 0.72rem; border-radius: 6px; cursor: pointer;
                ">📥 복원(JSON 업로드)</button>
                <input type="file" id="input-import-db-presets" accept=".json" style="display: none;">
            </div>
        `;

        modalOverlay.appendChild(modal);
        document.body.appendChild(modalOverlay);

        // 저장소 helper 함수
        const getPresets = () => {
            try {
                if (typeof GM_getValue === 'function') {
                    return GM_getValue('DB_ALL_PRESETS', []);
                }
                return JSON.parse(localStorage.getItem('DB_ALL_PRESETS') || '[]');
            } catch (e) {
                return [];
            }
        };

        const savePresets = (list) => {
            if (typeof GM_setValue === 'function') {
                GM_setValue('DB_ALL_PRESETS', list);
            }
            localStorage.setItem('DB_ALL_PRESETS', JSON.stringify(list));
        };

        // 프리셋 드롭다운 UI 업데이트
        const refreshPresetOptions = () => {
            const select = modal.querySelector('#db-preset-select');
            select.innerHTML = '<option value="">-- 프리셋을 선택하세요 --</option>';
            const list = getPresets();
            list.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.innerText = `${p.name} (${new Date(p.id).toLocaleDateString()})`;
                select.appendChild(opt);
            });
        };

        refreshPresetOptions();

        // 1) 프리셋 저장 실행 (현재 메인 화면 트라이포드 선택 상태 포함)
        modal.querySelector('#btn-save-db-preset').onclick = () => {
            const nameInput = modal.querySelector('#db-preset-name-input');
            const name = nameInput.value.trim();
            if (!name) {
                showAlert('프리셋 이름을 입력해주세요.');
                return;
            }

            const presets = getPresets();

            // 저장 직전 localStorage 및 전역 객체에서 최신 트라이포드 선택 상태 확보
            let currentSelectedTripods = window.selectedSkillTripods || {};
            try {
                const savedTripods = localStorage.getItem('LOSTARK_SELECTED_TRIPODS');
                if (savedTripods) {
                    currentSelectedTripods = JSON.parse(savedTripods);
                }
            } catch (e) {}

            const newPreset = {
                id: Date.now(),
                name: name,
                data: {
                    skillDatabase: window.skillDatabase || {},
                    orderDataSets: window.orderDataSets || {},
                    ADD_STAT_BASE: window.ADD_STAT_BASE_CUSTOM || [],
                    specializationDatabase: window.SPECIALIZATION_CUSTOM || {},
                    // 🌟 스킬 데이터와 함께 트라이포드 선택 상태 묶어서 저장
                    selectedSkillTripods: currentSelectedTripods
                }
            };

            presets.push(newPreset);
            savePresets(presets);
            nameInput.value = '';
            refreshPresetOptions();
            showAlert(`'${name}' 프리셋이 성공적으로 저장되었습니다! (트라이포드 세팅 포함)`);
        };

        modal.querySelector('#btn-load-db-preset').onclick = () => {
            const select = modal.querySelector('#db-preset-select');
            const id = Number(select.value);
            if (!id) {
                showAlert('불러올 프리셋을 선택해주세요.');
                return;
            }

            const presets = getPresets();
            const target = presets.find(p => p.id === id);
            if (!target) return;

            const d = target.data || {};

            // 1. 일반 스킬 / 코어 데이터 복원
            if (d.skillDatabase) {
                window.skillDatabase = JSON.parse(JSON.stringify(d.skillDatabase));
                if (typeof GM_setValue === 'function') GM_setValue('skillDatabase', window.skillDatabase);
            }
            if (d.orderDataSets) {
                window.orderDataSets = JSON.parse(JSON.stringify(d.orderDataSets));
                if (typeof GM_setValue === 'function') GM_setValue('orderDataSets', window.orderDataSets);
            }

            // 2. pure 커스텀 데이터 복원 및 저장소 저장
            const loadedCustomStat = d.ADD_STAT_BASE ? JSON.parse(JSON.stringify(d.ADD_STAT_BASE)) : [];
            const loadedCustomSpec = d.specializationDatabase ? JSON.parse(JSON.stringify(d.specializationDatabase)) : {};

            window.ADD_STAT_BASE_CUSTOM = loadedCustomStat;
            window.SPECIALIZATION_CUSTOM = loadedCustomSpec;

            if (typeof GM_setValue === 'function') {
                GM_setValue('ADD_STAT_BASE_CUSTOM', loadedCustomStat);
                GM_setValue('SPECIALIZATION_CUSTOM', loadedCustomSpec);
            }

            // 🌟 3. 스킬 데이터 세트의 트라이포드 선택 데이터 복원 및 저장
            const loadedTripods = d.selectedSkillTripods ? JSON.parse(JSON.stringify(d.selectedSkillTripods)) : {};
            window.selectedSkillTripods = loadedTripods;

            try {
                localStorage.setItem('LOSTARK_SELECTED_TRIPODS', JSON.stringify(loadedTripods));
            } catch (e) {
                console.error('트라이포드 LocalStorage 저장 실패:', e);
            }
            if (typeof GM_setValue === 'function') {
                GM_setValue('LOSTARK_SELECTED_TRIPODS', loadedTripods);
            }

            // 4. 내장 데이터(DEFAULT_ADD_STAT_BASE)와 불러온 커스텀 데이터를 재병합하여 연산 변수 갱신
            let baseArray = [];
            if (typeof DEFAULT_ADD_STAT_BASE !== 'undefined' && Array.isArray(DEFAULT_ADD_STAT_BASE)) {
                baseArray = JSON.parse(JSON.stringify(DEFAULT_ADD_STAT_BASE));
            }

            const baseNames = new Set(baseArray.map(item => item.name));
            const pureCustomData = loadedCustomStat.filter(item => item && item.name && !baseNames.has(item.name));

            window.ADD_STAT_BASE = [...baseArray, ...pureCustomData];

            // 🔥 [핵심 수정] specializationDatabase 연산 변수 복원 로직 추가
            const defaultSpec = (typeof DEFAULT_SPECIALIZATION_DATABASE !== 'undefined')
                ? JSON.parse(JSON.stringify(DEFAULT_SPECIALIZATION_DATABASE))
                : {};

            if (Array.isArray(loadedCustomSpec)) {
                window.specializationDatabase = loadedCustomSpec.length > 0 ? loadedCustomSpec : defaultSpec;
            } else if (loadedCustomSpec && typeof loadedCustomSpec === 'object' && Object.keys(loadedCustomSpec).length > 0) {
                window.specializationDatabase = { ...defaultSpec, ...loadedCustomSpec };
            } else {
                window.specializationDatabase = defaultSpec;
            }

            if (typeof GM_setValue === 'function') {
                GM_setValue('specializationDatabase', window.specializationDatabase);
            }

            // 🌟 5. 메인 UI 렌더링 및 트라이포드 선택 UI 즉시 재구성
            if (typeof window.resetState === 'function') window.resetState();
            if (typeof window.renderUI === 'function') window.renderUI();

            // 🔥 [중요] 스킬 & 트라이포드 메인 UI 재렌더링
            if (typeof renderSkillTripodUI === 'function') {
                renderSkillTripodUI();
            } else if (typeof window.renderSkillTripodUI === 'function') {
                window.renderSkillTripodUI();
            }

            // 최종 계산 및 트라이포드 선택 동기화 함수 호출
            if (typeof window.updateSelectedTripodsAndCalculate === 'function') {
                window.updateSelectedTripodsAndCalculate();
            } else if (typeof window.triggerCalculation === 'function') {
                window.triggerCalculation();
            }

            showAlert(`'${target.name}' 프리셋을 불러왔습니다! (스킬 DB 및 트라이포드 선택 적용 완료)`);
            modalOverlay.remove();

            if (typeof openDataLoaderModal === 'function') {
                openDataLoaderModal();
            }

            if (typeof window.triggerCalculation === 'function') window.triggerCalculation();
            if (typeof renderArkPassiveUI === 'function') renderArkPassiveUI();
            if (typeof renderSkillTripodUI === 'function') renderSkillTripodUI();
        };

        // 3) 프리셋 삭제 실행
        modal.querySelector('#btn-delete-db-preset').onclick = () => {
            const select = modal.querySelector('#db-preset-select');
            const id = Number(select.value);
            if (!id) {
                showAlert('삭제할 프리셋을 선택해주세요.');
                return;
            }
            showConfirm('정말 선택한 프리셋을 삭제하시겠습니까?', () => {
                let presets = getPresets();
                presets = presets.filter(p => p.id !== id);
                savePresets(presets);
                refreshPresetOptions();
                showAlert('프리셋이 삭제되었습니다.', '🗑️');
            }, '🗑️');
        };

        // 4) 내보내기 (JSON 다운로드)
        modal.querySelector('#btn-export-db-presets').onclick = () => {
            const presets = getPresets();
            if (presets.length === 0) {
                showAlert('내보낼 저장된 프리셋이 없습니다.');
                return;
            }
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(presets, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `arc_db_presets_${Date.now()}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        };

        // 5) 가져오기 (JSON 업로드 복원)
        const importInput = modal.querySelector('#input-import-db-presets');
        modal.querySelector('#btn-import-db-presets').onclick = () => importInput.click();
        importInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const parsed = JSON.parse(event.target.result);
                    if (Array.isArray(parsed)) {
                        savePresets(parsed);
                        refreshPresetOptions();
                        showAlert('프리셋 목록을 성공적으로 복원했습니다!');
                    } else {
                        showAlert('올바른 프리셋 파일 형식이 아닙니다.');
                    }
                } catch (err) {
                    showAlert(`파일 읽기 오류: ${err.message}`);
                }
            };
            reader.readAsText(file, 'UTF-8');
        };

        // 닫기 이벤트
        modal.querySelector('#close-preset-modal').onclick = () => modalOverlay.remove();
        modalOverlay.onclick = (e) => { if (e.target === modalOverlay) modalOverlay.remove(); };
    }

    // =========================================================================
    // 0. 질서 코어 누적/삭제/초기화 유틸리티 함수
    // =========================================================================
    function parseOrderDataSets(parsedData) {
        const rawData = parsedData.orderDataSets || parsedData;
        const formattedData = {};

        Object.entries(rawData).forEach(([key, core]) => {
            formattedData[key] = {
                id: core.id || key,
                name: core.name || key,
                slot: core.slot || '미지정',
                type: core.type || core.coreType || '', // 🌟 코어 타입(해/달/별) 추출
                grades: {}
            };

            const gradesSrc = core.grades || core;

            Object.entries(gradesSrc).forEach(([gradeKey, gradeVal]) => {
                if (typeof gradeVal !== 'object') return;

                formattedData[key].grades[gradeKey] = { points: {} };
                const pointsSrc = gradeVal.points || gradeVal;

                Object.entries(pointsSrc).forEach(([pointKey, pointVal]) => {
                    const nodesSrc = pointVal.nodes || (Array.isArray(pointVal) ? pointVal : [pointVal]);
                    formattedData[key].grades[gradeKey].points[pointKey] = {
                        nodes: Array.isArray(nodesSrc) ? nodesSrc : [nodesSrc]
                    };
                });
            });
        });

        return formattedData;
    }

    function removeOrderCore(coreKey) {
        if (window.orderDataSets && window.orderDataSets[coreKey]) {
            delete window.orderDataSets[coreKey];
            if (typeof GM_setValue === 'function') GM_setValue('orderDataSets', window.orderDataSets);
            else localStorage.setItem('orderDataSets', JSON.stringify(window.orderDataSets));
        }
    }

    function clearAllOrderCores() {
        window.orderDataSets = {};
        if (typeof GM_setValue === 'function') GM_setValue('orderDataSets', {});
        else localStorage.setItem('orderDataSets', JSON.stringify({}));
    }


    // =========================================================================
    // 1. 상태 UI 갱신 함수
    // =========================================================================
    function updateModalStatusUI() {
        const keys = ['skillDatabase', 'orderDataSets', 'ADD_STAT_BASE', 'specializationDatabase'];

        keys.forEach(keyName => {
            const statusElem = document.getElementById(`status-${keyName}`);
            if (!statusElem) return;

            // 🌟 커스텀 데이터 기준으로 상태 갱신 (기본 스탯 & 특화 데이터 분기)
            let customData;
            if (keyName === 'ADD_STAT_BASE') {
                customData = window.ADD_STAT_BASE_CUSTOM || [];
            } else if (keyName === 'specializationDatabase') {
                customData = window.SPECIALIZATION_CUSTOM || {};
            } else {
                customData = window[keyName] || {};
            }

            const count = Array.isArray(customData) ? customData.length : Object.keys(customData).length;

            statusElem.style.color = count > 0 ? '#4ade80' : '#f87171';
            statusElem.innerText = count > 0 ? `● 보유 중: ${count}개` : '○ 데이터 없음';
        });
    }

    // =========================================================================
    // 2. 데이터 불러오기 전용 모달 UI 생성 함수
    // =========================================================================
    function openDataLoaderModal() {

        if (document.getElementById('data-loader-modal')) return;

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'data-loader-modal';
        modalOverlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.7);
            z-index: 9999999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: #1e293b;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 20px;
            width: 460px;
            max-height: 90vh;
            overflow-y: auto;
            color: #f8fafc;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
            gap: 16px;
        `;

        modal.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
                <h3 style="margin: 0; font-size: 1.1rem; color: #38bdf8;">📂 시뮬레이터 데이터 설정 및 확인</h3>
                <span id="close-data-modal" style="cursor: pointer; font-size: 1.2rem; color: #94a3b8;">&times;</span>
            </div>
            <p style="margin: 0; font-size: 0.78rem; color: #94a3b8; line-height: 1.4;">
                기본 스탯/특화 데이터는 기존 코드 데이터를 유지하며, 업로드한 JSON 데이터가 누적 추가됩니다.
            </p>
        `;

        // =========================================================================
        // 상세보기 및 데이터 관리 모달 (showDataViewerModal)
        // =========================================================================
        const showDataViewerModal = (title, data, keyName = '') => {

            const detailOverlay = document.createElement('div');
            detailOverlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0, 0, 0, 0.8); z-index: 10000000;
                display: flex; align-items: center; justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            `;

            const detailBox = document.createElement('div');
            detailBox.style.cssText = `
                background: #0f172a; border: 1px solid rgba(255,255,255,0.2);
                border-radius: 12px; padding: 20px; width: 90%; max-width: 720px;
                max-height: 85vh; display: flex; flex-direction: column; color: #f8fafc;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7); overflow: hidden;
            `;

            let renderData = data || {};
            const count = Object.keys(renderData).length;

            // 1. 헤더 영역
            const header = document.createElement('div');
            header.style.cssText = `display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 12px; flex-shrink: 0;`;
            header.innerHTML = `
                <strong style="color: #38bdf8; font-size: 1.05rem; display: flex; align-items: center; gap: 6px;">
                    🔍 ${title} <span style="font-size: 0.8rem; color: #94a3b8; font-weight: normal;">(보유 개수: ${count}개)</span>
                </strong>
                <span id="close-detail-modal" style="cursor: pointer; font-size: 1.3rem; color: #94a3b8; line-height: 1;">&times;</span>
            `;
            detailBox.appendChild(header);

            // 2. 스크롤 가능한 본문 컨테이너
            const contentContainer = document.createElement('div');
            contentContainer.style.cssText = `overflow-y: auto; padding: 12px 6px 12px 0; display: flex; flex-direction: column; gap: 12px; flex: 1;`;

            if (!renderData || count === 0) {
                contentContainer.innerHTML = `<div style="text-align: center; color: #64748b; padding: 40px 0;">등록된 데이터가 없습니다.</div>`;
            }
            // 2. 스킬 데이터 (skillDatabase) - [단순 조회/열람 전용으로 변경]
            else if (keyName === 'skillDatabase' || title.includes('skillDatabase') || title.includes('스킬 데이터')) {

                // 각 스킬 카드 생성
                Object.entries(renderData).forEach(([skillKey, skill]) => {
                    const tagList = Array.isArray(skill.tags) ? skill.tags : (skill.tags || '').split(',').map(t => t.trim()).filter(Boolean);
                    const tagBadges = tagList.length > 0
                        ? tagList.map(t => `<span style="background: #334155; color: #38bdf8; padding: 2px 8px; border-radius: 12px; font-size: 0.72rem; border: 1px solid rgba(56, 189, 248, 0.2);">#${t}</span>`).join('')
                        : '<span style="font-size:0.75rem; color:#64748b;">태그 없음</span>';

                    const skillIdentifier = skill.name || skillKey;

                    let tripodsHtml = '';
                    if (skill.tripods && Array.isArray(skill.tripods) && skill.tripods.length > 0) {

                        // 티어별 그룹화
                        const groupedByTier = skill.tripods.reduce((acc, tripod) => {
                            const tier = tripod.tier || 1;
                            if (!acc[tier]) acc[tier] = [];
                            acc[tier].push(tripod);
                            return acc;
                        }, {});

                        const sortedTiers = Object.keys(groupedByTier).sort((a, b) => Number(a) - Number(b));

                        tripodsHtml = sortedTiers.map(tier => {
                            const tierTripods = groupedByTier[tier];

                            const optionsHtml = tierTripods.map((t) => {
                                const effectsHtml = (t.effects || []).map(e => {
                                    const val = e.value ?? e.val ?? 0;
                                    const sign = val > 0 ? '+' : '';
                                    return `<span style="color: #4ade80; font-weight: bold;">${e.category || e.type || '효과'} ${sign}${val}${e.unit || ''}</span>`;
                                }).join(', ');

                                return `
                                    <div style="
                                        display: flex; align-items: center; justify-content: space-between;
                                        background: #0f172a; border: 1px solid rgba(255, 255, 255, 0.08);
                                        padding: 8px 12px; border-radius: 6px;
                                    ">
                                        <span style="font-size: 0.83rem; font-weight: bold; color: #f8fafc;">${t.name}</span>
                                        <div style="font-size: 0.78rem;">${effectsHtml || '<span style="color:#64748b;">효과 없음</span>'}</div>
                                    </div>
                                `;
                            }).join('');

                            return `
                                <div style="background: #182234; border-left: 3px solid #2563eb; border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
                                    <span style="font-size: 0.8rem; font-weight: bold; color: #60a5fa;">🔱 ${tier}티어 트라이포드 목록</span>
                                    <div style="display: flex; flex-direction: column; gap: 6px;">
                                        ${optionsHtml}
                                    </div>
                                </div>
                            `;
                        }).join('');

                    } else {
                        tripodsHtml = `<div style="font-size: 0.75rem; color: #64748b; font-style: italic;">등록된 트라이포드 정보가 없습니다.</div>`;
                    }

                    const card = document.createElement('div');
                    card.className = 'skill-card-item';
                    card.style.cssText = `background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 12px; margin-bottom: 12px;`;
                    card.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">
                            <span style="font-size: 1rem; font-weight: bold; color: #f8fafc;">⚡ ${skillIdentifier}</span>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
                            <div style="background: #0f172a; padding: 8px; border-radius: 6px; text-align: center;"><div style="font-size: 0.68rem; color: #94a3b8;">상수</div><div style="font-size: 0.85rem; font-weight: bold;">${skill.constant ?? '-'}</div></div>
                            <div style="background: #0f172a; padding: 8px; border-radius: 6px; text-align: center;"><div style="font-size: 0.68rem; color: #94a3b8;">계수</div><div style="font-size: 0.85rem; font-weight: bold;">${skill.coefficient ?? '-'}</div></div>
                            <div style="background: #0f172a; padding: 8px; border-radius: 6px; text-align: center;"><div style="font-size: 0.68rem; color: #94a3b8;">쿨타임</div><div style="font-size: 0.85rem; font-weight: bold;">${skill.baseCooldown ?? '-'}s</div></div>
                            <div style="background: #0f172a; padding: 8px; border-radius: 6px; text-align: center;"><div style="font-size: 0.68rem; color: #94a3b8;">기본 마나</div><div style="font-size: 0.85rem; font-weight: bold;">${skill.mana ?? skill.baseMana ?? 0}</div></div>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 4px;"><span style="font-size: 0.72rem; color: #94a3b8; font-weight: bold;">🏷️ 태그</span><div style="display: flex; flex-wrap: wrap; gap: 4px;">${tagBadges}</div></div>
                        <div style="display: flex; flex-direction: column; gap: 6px;"><span style="font-size: 0.72rem; color: #94a3b8; font-weight: bold;">🔱 보유 트라이포드 스펙</span><div style="display: flex; flex-direction: column; gap: 8px;">${tripodsHtml}</div></div>
                    `;

                    contentContainer.appendChild(card);
                });
            }
            // 3. 기본 스탯 (ADD_STAT_BASE)
            else if (keyName === 'ADD_STAT_BASE' || title.includes('ADD_STAT_BASE') || title.includes('기본 스탯') || title.includes('기본스탯')) {
                const list = Array.isArray(renderData) ? renderData : Object.values(renderData);
                list.forEach((item, idx) => {
                    const card = document.createElement('div');
                    card.style.cssText = `background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px;`;

                    const name = item.name || item.statName || `사용자 스탯 #${idx + 1}`;
                    const effects = item.effects || (item.category ? [item] : []);

                    const effectsHtml = effects.map(e => {
                        const val = e.val ?? e.value ?? 0;
                        const sign = val > 0 ? '+' : '';
                        const reqTags = e.requireTags || e.targetTags || e.tags || [];
                        const tagList = Array.isArray(reqTags) ? reqTags : (typeof reqTags === 'string' ? reqTags.split(',').map(t => t.trim()) : []);
                        const tagBadges = tagList.map(t => `<span style="background: #334155; color: #c084fc; padding: 1px 6px; border-radius: 8px; font-size: 0.7rem; border: 1px solid rgba(192, 132, 252, 0.2);">#${t}</span>`).join(' ');

                        return `
                            <div style="display: flex; align-items: center; gap: 6px; background: #0f172a; padding: 4px 10px; border-radius: 6px;">
                                ${tagBadges ? `<div style="display: flex; gap: 4px;">${tagBadges}</div>` : ''}
                                <span style="font-size: 0.82rem; font-weight: bold; color: #4ade80;">${e.category || e.type || ''} ${sign}${val}${e.unit || ''}</span>
                            </div>
                        `;
                    }).join('');

                    card.innerHTML = `
                        <span style="font-weight: bold; font-size: 0.9rem; color: #f8fafc; white-space: nowrap;">📊 ${name}</span>
                        <div style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end;">${effectsHtml || '<span style="font-size: 0.8rem; color: #64748b;">효과 없음</span>'}</div>
                    `;
                    contentContainer.appendChild(card);
                });
            }
            // 4. 특화 데이터 (specializationDatabase) - 보기 전용 (저장/덮어쓰기는 업로드 핸들러에서만 수행)
            else if (keyName === 'specializationDatabase') {
                const pre = document.createElement('pre');
                pre.style.cssText = 'margin:0; padding:12px; background:#0f172a; border:1px solid #334155; border-radius:8px; color:#e2e8f0; font-size:0.78rem; white-space:pre-wrap; word-break:break-all;';
                pre.textContent = JSON.stringify(renderData, null, 2);
                contentContainer.appendChild(pre);
            }
            // 5. 질서 코어 (orderDataSets)
            else if (keyName === 'orderDataSets' || title.includes('orderDataSets') || title.includes('질서')) {
                const getCorePriority = (coreData) => {
                    const type = (coreData.type || coreData.coreType || '').toLowerCase();
                    if (type.includes('해') || type === 'sun') return 1;
                    if (type.includes('달') || type === 'moon') return 2;
                    if (type.includes('별') || type === 'star') return 3;
                    return 4;
                };

                const sortedEntries = Object.entries(renderData).sort((a, b) => {
                    return getCorePriority(a[1]) - getCorePriority(b[1]);
                });

                sortedEntries.forEach(([coreKey, coreData]) => {
                    const card = document.createElement('div');
                    card.style.cssText = `background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 12px;`;

                    const coreName = coreData.name || coreKey;
                    const coreType = coreData.type || coreData.coreType || '';

                    let typeBadgeHtml = '';
                    if (coreType.includes('해') || coreType.toLowerCase() === 'sun') {
                        typeBadgeHtml = `<span style="background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.4); padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: bold;">☀️ ${coreType || '해'}</span>`;
                    } else if (coreType.includes('달') || coreType.toLowerCase() === 'moon') {
                        typeBadgeHtml = `<span style="background: rgba(59, 130, 246, 0.2); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.4); padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: bold;">🌙 ${coreType || '달'}</span>`;
                    } else if (coreType.includes('별') || coreType.toLowerCase() === 'star') {
                        typeBadgeHtml = `<span style="background: rgba(234, 179, 8, 0.2); color: #fde047; border: 1px solid rgba(234, 179, 8, 0.4); padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: bold;">⭐ ${coreType || '별'}</span>`;
                    } else if (coreType) {
                        typeBadgeHtml = `<span style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: bold;">🔮 ${coreType}</span>`;
                    }

                    let gradesHtml = '';
                    const gradesObj = coreData.grades || coreData;

                    if (gradesObj && typeof gradesObj === 'object') {
                        Object.entries(gradesObj).forEach(([gradeName, gradeContent]) => {
                            const pointsObj = gradeContent.points || gradeContent;
                            let pointsHtml = '';

                            if (pointsObj && typeof pointsObj === 'object') {
                                Object.entries(pointsObj).forEach(([pointKey, pointContent]) => {
                                    const nodes = pointContent.nodes || (Array.isArray(pointContent) ? pointContent : [pointContent]);
                                    const nodeList = Array.isArray(nodes) ? nodes : [nodes];

                                    nodeList.forEach(node => {
                                        const effects = node.effects || [];
                                        const effectRows = effects.map(e => {
                                            const reqTags = Array.isArray(e.requireTags) ? e.requireTags : (e.requireTags ? [e.requireTags] : []);
                                            const tagBadges = reqTags.map(t => `<span style="background: #334155; color: #c084fc; padding: 1px 6px; border-radius: 10px; font-size: 0.7rem;">#${t}</span>`).join(' ');
                                            const val = e.val ?? e.value ?? 0;
                                            const sign = val > 0 ? '+' : '';

                                            return `
                                                <div style="display: flex; justify-content: space-between; align-items: center; background: #0f172a; padding: 6px 10px; border-radius: 6px; font-size: 0.8rem;">
                                                    <span style="color: #cbd5e1;">${e.category || e.type || '효과'} ${tagBadges}</span>
                                                    <span style="color: #4ade80; font-weight: bold;">${sign}${val}${e.unit || ''}</span>
                                                </div>
                                            `;
                                        }).join('');

                                        pointsHtml += `
                                            <div style="background: #182234; border-left: 3px solid #a855f7; border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px;">
                                                <div style="font-size: 0.78rem; font-weight: bold; color: #c084fc;">📍 ${pointKey}pt 노드</div>
                                                ${effectRows}
                                            </div>
                                        `;
                                    });
                                });
                            }

                            gradesHtml += `
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                    <div style="font-size: 0.82rem; font-weight: bold; color: #38bdf8;">[${gradeName}]</div>
                                    ${pointsHtml}
                                </div>
                            `;
                        });
                    }

                    card.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 1rem; font-weight: bold; color: #a855f7;">🔮 코어: ${coreName}</span>
                                ${typeBadgeHtml}
                            </div>
                            <button class="btn-delete-single-core" style="background: #dc2626; color: #fff; border: none; padding: 4px 8px; font-size: 0.72rem; border-radius: 4px; cursor: pointer;">🗑️ 삭제</button>
                        </div>
                        ${gradesHtml}
                    `;

                    card.querySelector('.btn-delete-single-core').onclick = () => {
                        if (confirm(`'${coreName}' 코어를 삭제하시겠습니까?`)) {
                            removeOrderCore(coreKey);
                            card.remove();

                            if (typeof updateModalStatusUI === 'function') updateModalStatusUI();

                            if (!window.orderDataSets || Object.keys(window.orderDataSets).length === 0) {
                                contentContainer.innerHTML = `<div style="text-align: center; color: #64748b; padding: 40px 0;">등록된 데이터가 없습니다.</div>`;
                            }

                            showAlert('코어가 삭제되었습니다.');
                        }
                    };

                    contentContainer.appendChild(card);
                });
            }
            detailBox.appendChild(contentContainer);

            // keyName이 'orderDataSets'이거나 title에 'orderDataSets' 또는 '질서'가 포함되어 있는지 모두 체크
            if (keyName === 'orderDataSets' || title.includes('orderDataSets') || title.includes('질서')) {
                const footer = document.createElement('div');
                footer.style.cssText = `
                    border-top: 1px solid #334155;
                    padding-top: 12px;
                    margin-top: 8px;
                    display: flex;
                    justify-content: flex-end;
                    flex-shrink: 0;
                    background: #0f172a;
                `;

                const clearBtn = document.createElement('button');
                clearBtn.innerText = '🗑️ 질서 코어 전체 초기화';
                clearBtn.style.cssText = `
                    width: 100%;
                    padding: 10px;
                    font-size: 0.82rem;
                    font-weight: bold;
                    background: #dc2626;
                    color: #fff;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: background 0.2s;
                `;
                clearBtn.onmouseover = () => clearBtn.style.background = '#b91c1c';
                clearBtn.onmouseout = () => clearBtn.style.background = '#dc2626';

                clearBtn.onclick = () => {
                    if (confirm('저장된 모든 질서 코어 데이터를 삭제하시겠습니까?')) {
                        clearAllOrderCores();
                        if (typeof updateModalStatusUI === 'function') updateModalStatusUI();
                        detailOverlay.remove();

                        showAlert('모든 질서 코어가 초기화되었습니다.');
                        if (typeof window.triggerCalculation === 'function') window.triggerCalculation();
                    }
                };

                footer.appendChild(clearBtn);
                detailBox.appendChild(footer);
            }

            detailOverlay.appendChild(detailBox);
            document.body.appendChild(detailOverlay);

            detailBox.querySelector('#close-detail-modal').onclick = () => detailOverlay.remove();
            detailOverlay.onclick = (e) => { if (e.target === detailOverlay) detailOverlay.remove(); };
        };

        const createFileInputGroup = (label, keyName) => {
            const group = document.createElement('div');
            group.style.cssText = `
                display: flex; align-items: center; justify-content: space-between;
                background: #0f172a; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);
            `;

            // 🌟 커스텀 데이터만 추출 (기본 스탯 & 특화 데이터는 CUSTOM 변수 참조)
            // 🌟 페이지 로드 시 복원된 데이터까지 올바르게 읽어오도록 수정
            const getCustomData = () => {
                if (keyName === 'ADD_STAT_BASE') {
                    const stored = (typeof GM_getValue === 'function') ? GM_getValue('ADD_STAT_BASE_CUSTOM', null) : null;
                    return window.ADD_STAT_BASE_CUSTOM || stored || window.ADD_STAT_BASE || [];
                }
                if (keyName === 'specializationDatabase') {
                    const stored = (typeof GM_getValue === 'function') ? GM_getValue('SPECIALIZATION_CUSTOM', null) : null;
                    return window.SPECIALIZATION_CUSTOM || stored || window.specializationDatabase || {};
                }

                // 스킬 데이터, 질서 코어 등 일반 키
                const stored = (typeof GM_getValue === 'function') ? GM_getValue(keyName, null) : null;
                return window[keyName] || stored || {};
            };

            const getCount = () => {
                const data = getCustomData();
                return Array.isArray(data) ? data.length : Object.keys(data).length;
            };

            group.innerHTML = `
                <div>
                    <div style="font-size: 0.85rem; font-weight: bold; color: #e2e8f0;">${label}</div>
                    <div id="status-${keyName}" style="font-size: 0.7rem; color: ${getCount() > 0 ? '#4ade80' : '#f87171'}; margin-top: 2px;">
                        ${getCount() > 0 ? `● 보유 중: ${getCount()}개` : '○ 데이터 없음'}
                    </div>
                </div>
                <div style="display: flex; gap: 6px; align-items: center;">
                    <button class="btn-view-data" style="background: #334155; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 5px 8px; font-size: 0.72rem; font-weight: 600; border-radius: 6px; cursor: pointer;">👁️ 확인</button>
                    <label style="background: #2563eb; color: #fff; padding: 6px 10px; font-size: 0.75rem; font-weight: 600; border-radius: 6px; cursor: pointer;">
                        파일 선택
                        <input type="file" accept=".json" style="display: none;" data-key="${keyName}">
                    </label>
                </div>
            `;

            // 확인 버튼 클릭 시 커스텀 데이터만 viewer 모달로 전달
            group.querySelector('.btn-view-data').onclick = () => showDataViewerModal(label, getCustomData(), keyName);

            const fileInput = group.querySelector('input');
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const parsed = JSON.parse(event.target.result);

                        if (keyName === 'orderDataSets') {
                            const newCores = parseOrderDataSets(parsed);
                            window.orderDataSets = { ...(window.orderDataSets || {}), ...newCores };
                            if (typeof GM_setValue === 'function') GM_setValue('orderDataSets', window.orderDataSets);
                        }
                        else if (keyName === 'ADD_STAT_BASE') {
                            const uploadedStats = Array.isArray(parsed) ? parsed : (parsed.ADD_STAT_BASE || Object.values(parsed));
                            window.ADD_STAT_BASE_CUSTOM = uploadedStats;
                            if (typeof GM_setValue === 'function') GM_setValue('ADD_STAT_BASE_CUSTOM', uploadedStats);

                            const defaultStats = (typeof DEFAULT_ADD_STAT_BASE !== 'undefined') ? JSON.parse(JSON.stringify(DEFAULT_ADD_STAT_BASE)) : [];
                            window.ADD_STAT_BASE = [...defaultStats, ...uploadedStats];
                        }
                        // 🌟 [추가] 특화 데이터 커스텀 처리
                        else if (keyName === 'specializationDatabase') {
                            // 1. 전체 세팅 파일(통합 JSON)인지, 개별 객체인지 판단하여 실제 특화 데이터 추출
                            let actualData = parsed;

                            // parsed가 전체 통합 객체이고 내부 'specializationDatabase' 키가 존재하면 추출
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.specializationDatabase) {
                                actualData = parsed.specializationDatabase;
                            }

                            // 2. 기본값 복사본 준비
                            const defaultSpec = (typeof DEFAULT_SPECIALIZATION_DATABASE !== 'undefined')
                                ? JSON.parse(JSON.stringify(DEFAULT_SPECIALIZATION_DATABASE))
                                : {};

                            // 3. 추출된 actualData 유효성 검사 및 대입
                            let finalSpecData;

                            if (Array.isArray(actualData)) {
                                finalSpecData = actualData.length > 0 ? actualData : defaultSpec;
                            } else if (actualData && typeof actualData === 'object' && Object.keys(actualData).length > 0) {
                                finalSpecData = { ...defaultSpec, ...actualData };
                            } else {
                                finalSpecData = defaultSpec;
                            }

                            // 4. 전역 변수 및 GM 스토리지 갱신
                            window.SPECIALIZATION_CUSTOM = finalSpecData;
                            window.specializationDatabase = finalSpecData;

                            if (typeof GM_setValue === 'function') {
                                GM_setValue('SPECIALIZATION_CUSTOM', finalSpecData);
                                GM_setValue('specializationDatabase', finalSpecData);
                            }

                            // 5. UI 상태 표시 업데이트
                            const statusElem = document.getElementById(`status-${keyName}`);
                            if (statusElem) {
                                const count = Array.isArray(finalSpecData)
                                    ? finalSpecData.length
                                    : Object.keys(finalSpecData || {}).length;
                                statusElem.style.color = count > 0 ? '#4ade80' : '#f87171';
                                statusElem.innerText = count > 0 ? `● 보유 중: ${count}개` : '○ 데이터 없음';
                            }

                            // 6. 계산 트리거 및 하단 공통 덮어쓰기 로직 탈출
                            if (typeof window.triggerCalculation === 'function') window.triggerCalculation();

                            return; // 🌟 하단 공통 루프에서 window.specializationDatabase = {} 로 덮어쓰는 것 완전 차단
                        }
                        else {
                            window[keyName] = parsed;
                            if (typeof GM_setValue === 'function') GM_setValue(keyName, parsed);
                        }

                        // UI 개수 상태 즉시 최신화
                        const statusElem = document.getElementById(`status-${keyName}`);
                        if (statusElem) {
                            const count = getCount();
                            statusElem.style.color = count > 0 ? '#4ade80' : '#f87171';
                            statusElem.innerText = count > 0 ? `● 보유 중: ${count}개` : '○ 데이터 없음';
                        }

                        if (typeof window.triggerCalculation === 'function') window.triggerCalculation();

                    } catch (err) {
                        showAlert(`JSON 파싱 오류: ${err.message}`);
                    }
                };
                reader.readAsText(file, 'UTF-8');
            });

            return group;
        };

        modal.appendChild(createFileInputGroup('1. 스킬 데이터', 'skillDatabase'));
        modal.appendChild(createFileInputGroup('2. 질서 코어', 'orderDataSets'));
        modal.appendChild(createFileInputGroup('3. 기본 스탯', 'ADD_STAT_BASE'));
        modal.appendChild(createFileInputGroup('4. 특화 데이터', 'specializationDatabase'));

        // 5. 게임 데이터(JSON 외부 파일) 관리: 내보내기 / 업로드 / 기본값 복원
        const gameDataGroup = document.createElement('div');
        gameDataGroup.style.cssText = 'background:#0f172a; border-radius:8px; border:1px solid rgba(255,255,255,0.05); padding:10px; display:flex; flex-direction:column; gap:8px;';
        const overrideKeys = Object.keys(GAME_DATA_OVERRIDE);
        gameDataGroup.innerHTML = `
            <div style="font-size:0.85rem; font-weight:bold; color:#a5b4fc;">5. 게임 데이터 (각인·혼돈 코어·팔찌·장신구 등)</div>
            <div style="font-size:0.74rem; color:#94a3b8; line-height:1.4;">
                현재 상태: ${overrideKeys.length ? '<b style="color:#4ade80">JSON 적용 중</b> (' + overrideKeys.join(', ') + ')' : '코드 기본값 사용'}<br>
                내보낸 JSON을 수정해 다시 올리면 됩니다. 일부 항목만 담아도 되며, 적용은 새로고침 후 반영됩니다.
            </div>
            <div style="display:flex; gap:6px;">
                <button id="gd-export" style="flex:1; padding:8px; background:#0ea5e9; color:#fff; border:none; border-radius:6px; font-size:0.78rem; font-weight:bold; cursor:pointer;">⬇ 현재 데이터 내보내기</button>
                <button id="gd-import" style="flex:1; padding:8px; background:#22c55e; color:#fff; border:none; border-radius:6px; font-size:0.78rem; font-weight:bold; cursor:pointer;">⬆ JSON 업로드</button>
                <button id="gd-reset" style="flex:1; padding:8px; background:#475569; color:#fff; border:none; border-radius:6px; font-size:0.78rem; font-weight:bold; cursor:pointer;">↺ 기본값 복원</button>
            </div>
            <input type="file" id="gd-file" accept=".json,application/json" style="display:none;">
        `;
        modal.appendChild(gameDataGroup);

        gameDataGroup.querySelector('#gd-export').onclick = () => {
            const out = {};
            Object.keys(GAME_DATA_TABLES).forEach(k => { out[k] = GAME_DATA_TABLES[k]; });
            const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'lostark_game_data.json';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        };
        gameDataGroup.querySelector('#gd-import').onclick = () => gameDataGroup.querySelector('#gd-file').click();
        gameDataGroup.querySelector('#gd-file').onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const parsed = JSON.parse(ev.target.result);
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('최상위는 { 표이름: 데이터 } 형태의 객체여야 합니다.');
                    const accepted = {}, skipped = [];
                    Object.keys(parsed).forEach(k => {
                        const def = GAME_DATA_DEFAULTS[k];
                        const v = parsed[k];
                        if (def === undefined || v === null || typeof v !== 'object' || Array.isArray(def) !== Array.isArray(v)) skipped.push(k);
                        else accepted[k] = v;
                    });
                    if (!Object.keys(accepted).length) throw new Error('적용할 수 있는 항목이 없습니다. (사용 가능: ' + Object.keys(GAME_DATA_DEFAULTS).join(', ') + ')');
                    GM_setValue('GAME_DATA_OVERRIDE', Object.assign({}, GAME_DATA_OVERRIDE, accepted));
                    alert('적용 완료: ' + Object.keys(accepted).join(', ') + (skipped.length ? '\n무시됨: ' + skipped.join(', ') : '') + '\n새로고침하면 반영됩니다.');
                    location.reload();
                } catch (err) {
                    alert('JSON 적용 실패: ' + err.message);
                }
            };
            reader.readAsText(file, 'UTF-8');
            e.target.value = '';
        };
        gameDataGroup.querySelector('#gd-reset').onclick = () => {
            if (!confirm('업로드한 게임 데이터를 지우고 코드 기본값으로 되돌릴까요?')) return;
            GM_setValue('GAME_DATA_OVERRIDE', {});
            location.reload();
        };

        // 🌟 [신규] 전체 데이터 통합 디버그 뷰어 (접이식 섹션)
        const debugSection = document.createElement('div');
        debugSection.style.cssText = `
            background: #0f172a; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);
            padding: 10px; display: flex; flex-direction: column; gap: 8px;
        `;
        debugSection.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" id="toggle-debug-viewer">
                <span style="font-size: 0.8rem; font-weight: bold; color: #a5b4fc;">🔍 전체 로드 데이터 실시간 보기</span>
                <span id="debug-toggle-icon" style="font-size: 0.8rem; color: #94a3b8;">▼ 펼치기</span>
            </div>
            <pre id="debug-json-content" style="
                display: none; background: #1e293b; color: #38bdf8; padding: 10px; border-radius: 6px;
                max-height: 180px; overflow: auto; font-family: monospace; font-size: 0.7rem;
                white-space: pre-wrap; word-break: break-all; margin: 0;
            "></pre>
        `;

        modal.appendChild(debugSection);


        const toggleBtn = debugSection.querySelector('#toggle-debug-viewer');
        const debugContent = debugSection.querySelector('#debug-json-content');
        const debugIcon = debugSection.querySelector('#debug-toggle-icon');

        toggleBtn.onclick = () => {
            const isHidden = debugContent.style.display === 'none';
            if (isHidden) {
                const combinedData = {
                    skillDatabase: window.skillDatabase || {},
                    orderDataSets: window.orderDataSets || {},
                    ADD_STAT_BASE: window.ADD_STAT_BASE || [],
                    specializationDatabase: window.specializationDatabase || {}
                };
                debugContent.innerText = JSON.stringify(combinedData, null, 2);
                debugContent.style.display = 'block';
                debugIcon.innerText = '▲ 접기';
            } else {
                debugContent.style.display = 'none';
                debugIcon.innerText = '▼ 펼치기';
            }
        };

        // 🌟 하단 푸터 영역 (프리셋 관리 / 전체 초기화 2종 구성)
        const footer = document.createElement('div');
        footer.style.cssText = `
            display: flex; gap: 8px; margin-top: 4px; padding-top: 10px;
            border-top: 1px solid rgba(255,255,255,0.1);
        `;

        // 1. 프리셋 관리 버튼
        const presetManageBtn = document.createElement('button');
        presetManageBtn.innerText = '📦 프리셋 관리';
        presetManageBtn.style.cssText = `
            flex: 1; padding: 10px; font-size: 0.8rem; font-weight: bold;
            background: #4f46e5; color: #fff; border: none; border-radius: 6px; cursor: pointer;
            transition: background 0.2s;
        `;
        presetManageBtn.onmouseover = () => presetManageBtn.style.background = '#4338ca';
        presetManageBtn.onmouseout = () => presetManageBtn.style.background = '#4f46e5';

        presetManageBtn.onclick = () => {
            modalOverlay.remove();
            openDataPresetModal();
        };

        // 2. 전체 초기화 버튼
        const clearBtn = document.createElement('button');
        clearBtn.innerText = '🗑️ 전체 초기화';
        clearBtn.style.cssText = `
            flex: 1; padding: 10px; font-size: 0.8rem; font-weight: bold;
            background: #ef4444; color: #fff; border: none; border-radius: 6px; cursor: pointer;
            transition: background 0.2s;
        `;
        clearBtn.onmouseover = () => clearBtn.style.background = '#dc2626';
        clearBtn.onmouseout = () => clearBtn.style.background = '#ef4444';

        clearBtn.onclick = () => {
            if (confirm('저장된 모든 커스텀 데이터를 초기화하시겠습니까?')) {
                const defaultSpec = (typeof DEFAULT_SPECIALIZATION_DATABASE !== 'undefined')
                    ? JSON.parse(JSON.stringify(DEFAULT_SPECIALIZATION_DATABASE))
                    : {};
                const defaultStats = (typeof DEFAULT_ADD_STAT_BASE !== 'undefined')
                    ? JSON.parse(JSON.stringify(DEFAULT_ADD_STAT_BASE))
                    : [];

                if (typeof GM_setValue === 'function') {
                    GM_setValue('skillDatabase', {});
                    GM_setValue('orderDataSets', {});
                    GM_setValue('ADD_STAT_BASE_CUSTOM', []);
                    GM_setValue('SPECIALIZATION_CUSTOM', null); // 🌟 null로 명확히 비움
                    GM_setValue('specializationDatabase', defaultSpec);
                }

                window.skillDatabase = {};
                window.orderDataSets = {};
                window.ADD_STAT_BASE_CUSTOM = [];
                window.SPECIALIZATION_CUSTOM = null;

                window.ADD_STAT_BASE = defaultStats;
                window.specializationDatabase = defaultSpec;

                // UI 갱신
                ['skillDatabase', 'orderDataSets', 'ADD_STAT_BASE', 'specializationDatabase'].forEach(key => {
                    const statusElem = document.getElementById(`status-${key}`);
                    if (statusElem) {
                        statusElem.style.color = '#f87171';
                        statusElem.innerText = '○ 데이터 없음';
                    }
                });

                showAlert('모든 커스텀 데이터가 초기화되었습니다.');
                if (typeof renderSkillTripodUI === 'function') renderSkillTripodUI();
                if (typeof window.triggerCalculation === 'function') window.triggerCalculation();
            }
        };

        footer.appendChild(presetManageBtn);
        footer.appendChild(clearBtn);
        modal.appendChild(footer);

        modalOverlay.appendChild(modal);
        document.body.appendChild(modalOverlay);

        modal.querySelector('#close-data-modal').onclick = () => modalOverlay.remove();
        modalOverlay.onclick = (e) => { if (e.target === modalOverlay) modalOverlay.remove(); };
    }


    // =========================================================================
    // 3. 플로팅 패널 injectPauseButton 함수
    // =========================================================================
    function injectPauseButton() {
        if (document.getElementById('calc-floating-panel')) return;

        // -------------------------------------------------------------
        // 🌟 공지사항 모달(팝업) 생성 함수
        // -------------------------------------------------------------
        const createNoticeModal = () => {
            if (document.getElementById('calc-notice-modal')) return;

            // 1) 모달 오버레이 (배경)
            const overlay = document.createElement('div');
            overlay.id = 'calc-notice-modal';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(4px);
                z-index: 1000000;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                transition: opacity 0.2s ease;
            `;

            // 2) 모달 창 본체
            const modal = document.createElement('div');
            modal.style.cssText = `
                background: #1e293b;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 12px;
                width: 90%;
                max-width: 480px;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
                color: #f8fafc;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                transform: translateY(10px);
                transition: transform 0.2s ease;
            `;

            // 3) 모달 헤더
            const header = document.createElement('div');
            header.style.cssText = `
                padding: 14px 18px;
                background: #0f172a;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                display: flex;
                justify-content: space-between;
                align-items: center;
            `;

            const title = document.createElement('h3');
            title.innerText = '📢 Notice & Updates';
            title.style.cssText = `
                margin: 0;
                font-size: 1rem;
                font-weight: 700;
                color: #fbcfe8;
            `;

            const closeBtn = document.createElement('button');
            closeBtn.innerText = '✕';
            closeBtn.style.cssText = `
                background: none;
                border: none;
                color: #94a3b8;
                font-size: 1.2rem;
                cursor: pointer;
                padding: 0;
                line-height: 1;
            `;
            closeBtn.onmouseover = () => closeBtn.style.color = '#ffffff';
            closeBtn.onmouseout = () => closeBtn.style.color = '#94a3b8';

            header.appendChild(title);
            header.appendChild(closeBtn);

            // 4) 모달 본문
            const body = document.createElement('div');
            body.style.cssText = `
                padding: 20px;
                font-size: 0.875rem;
                line-height: 1.6;
                color: #cbd5e1;
                max-height: 65vh;
                overflow-y: auto;
            `;

            body.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 14px;">
                    <!-- 1번 항목: 내실 -->
                    <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px 14px;">
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                            <span style="background: #0284c7; color: #ffffff; font-size: 0.7rem; font-weight: bold; padding: 2px 6px; border-radius: 4px;">기본 전제</span>
                            <strong style="color: #f8fafc; font-size: 0.85rem;">내실 기본 설정</strong>
                        </div>
                        <div style="color: #94a3b8; font-size: 0.8rem; padding-left: 2px;">
                            기본적인 내실은 <span style="color: #38bdf8; font-weight: 600;">최대치</span>를 가정하고 계산합니다.
                        </div>
                    </div>

                    <!-- 2번 항목: 장비 -->
                    <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px 14px;">
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                            <span style="background: #d97706; color: #ffffff; font-size: 0.7rem; font-weight: bold; padding: 2px 6px; border-radius: 4px;">지원 장비</span>
                            <strong style="color: #f8fafc; font-size: 0.85rem;">장비 범위</strong>
                        </div>
                        <div style="color: #94a3b8; font-size: 0.8rem; padding-left: 2px;">
                            장비는 <span style="color: #fbbf24; font-weight: 600;">T4 전율</span> 및 <span style="color: #fbbf24; font-weight: 600;">에스더 장비</span>만 지원합니다.
                        </div>
                    </div>

                    <!-- 3번 항목: 보석 -->
                    <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px 14px;">
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                            <span style="background: #d97706; color: #ffffff; font-size: 0.7rem; font-weight: bold; padding: 2px 6px; border-radius: 4px;">미지원</span>
                            <strong style="color: #f8fafc; font-size: 0.85rem;">보석</strong>
                        </div>
                        <div style="color: #94a3b8; font-size: 0.8rem; padding-left: 2px;">
                            <span style="color: #fbbf24; font-weight: 600;">6레벨 이상</span> 보석만 계산 가능합니다.
                        </div>
                    </div>

                    <!-- 4번 항목: 코어 -->
                    <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px 14px;">
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                            <span style="background: #dc2626; color: #ffffff; font-size: 0.7rem; font-weight: bold; padding: 2px 6px; border-radius: 4px;">미지원</span>
                            <strong style="color: #f8fafc; font-size: 0.85rem;">혼돈 코어 옵션</strong>
                        </div>
                        <div style="color: #94a3b8; font-size: 0.8rem; padding-left: 2px;">
                            혼돈 코어 중 <span style="color: #f87171; font-weight: 600;">서포터 옵션</span>의 코어는 지원하지 않습니다.
                        </div>
                    </div>

                    <!-- 5번 항목: 미지원 노드 -->
                    <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px 14px;">
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                            <span style="background: #dc2626; color: #ffffff; font-size: 0.7rem; font-weight: bold; padding: 2px 6px; border-radius: 4px;">미지원</span>
                            <strong style="color: #f8fafc; font-size: 0.85rem;">아크 패시브 노드 예외</strong>
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;">
                            <span style="background: #1e293b; color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1); font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">제압</span>
                            <span style="background: #1e293b; color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1); font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">인내</span>
                            <span style="background: #1e293b; color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1); font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">숙련</span>
                            <span style="background: #1e293b; color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1); font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">축복의 여신</span>
                            <span style="background: #1e293b; color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1); font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">정열의 춤사위</span>
                            <span style="background: #1e293b; color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1); font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">선각자</span>
                            <span style="background: #1e293b; color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1); font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">진군</span>
                            <span style="background: #1e293b; color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1); font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">기원</span>
                            <span style="background: #1e293b; color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1); font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">안정된 관리자</span>
                        </div>
                    </div>

                    <!-- 🌟 업데이트 내역 섹션 -->
                    <div style="border-top: 1px solid rgba(255, 255, 255, 0.12); padding-top: 16px; margin-top: 8px;">
                        <!-- 헤더 -->
                        <div style="font-size: 0.85rem; font-weight: 700; color: #38bdf8; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
                            <span style="display: inline-block; width: 6px; height: 6px; background-color: #38bdf8; border-radius: 50%;"></span>
                            🛠️ 업데이트 내역
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <!-- v1.1.1 카드 -->
                            <div style="background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 10px; padding: 12px 14px; transition: all 0.2s ease;">
                                <!-- 버전 및 날짜 -->
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                    <span style="background: rgba(74, 222, 128, 0.15); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3); font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 20px;">
                                        v1.2.0
                                    </span>
                                    <span style="color: #64748b; font-size: 0.72rem; font-weight: 500;">2026.11.11</span>
                                </div>

                                <!-- 내역 리스트 -->
                                <ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px;">
                                    <li style="display: flex; align-items: flex-start; gap: 6px; color: #a78bfa; font-size: 0.78rem; line-height: 1.4;">
                                        <span style="color: #a78bfa; font-size: 0.68rem; font-weight: bold; background: rgba(56, 189, 248, 0.15); padding: 1px 5px; border-radius: 4px; flex-shrink: 0; margin-top: 1px;">다중 치명타 계산 지원</span>

                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>

                </div>
            `;

            // 5) 모달 푸터
            const footer = document.createElement('div');
            footer.style.cssText = `
                padding: 12px 18px;
                background: #0f172a;
                border-top: 1px solid rgba(255, 255, 255, 0.08);
                display: flex;
                justify-content: flex-end;
            `;

            const confirmBtn = document.createElement('button');
            confirmBtn.innerText = '확인';
            confirmBtn.style.cssText = `
                padding: 6px 16px;
                background-color: #db2777;
                border: 1px solid #f472b6;
                color: #ffffff;
                border-radius: 6px;
                font-size: 0.8rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s ease;
            `;
            confirmBtn.onmouseover = () => confirmBtn.style.filter = 'brightness(1.15)';
            confirmBtn.onmouseout = () => confirmBtn.style.filter = 'none';

            footer.appendChild(confirmBtn);

            modal.appendChild(header);
            modal.appendChild(body);
            modal.appendChild(footer);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            // 닫기 애니메이션 함수
            const closeModal = () => {
                overlay.style.opacity = '0';
                modal.style.transform = 'translateY(10px)';
                setTimeout(() => overlay.remove(), 200);
            };

            // 이벤트 바인딩
            closeBtn.onclick = closeModal;
            confirmBtn.onclick = closeModal;
            overlay.onclick = (e) => {
                if (e.target === overlay) closeModal();
            };

            // 열기 애니메이션 효과
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                modal.style.transform = 'translateY(0)';
            });
        };

        // 1) 전체 플로팅 컨테이너
        const panel = document.createElement('div');
        panel.id = 'calc-floating-panel';
        panel.style.cssText = `
            position: fixed;
            bottom: 25px;
            left: 25px;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            background: #161d24;
            border: 1px solid rgba(255, 255, 255, 0.08);
            padding: 12px;
            border-radius: 10px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            width: 175px;
        `;

        // 공통 버튼 생성 함수
        const createButton = (text, bgColor, borderColor, onClick, id = '') => {
            const btn = document.createElement('button');
            if (id) btn.id = id;
            btn.type = 'button';
            btn.innerText = text;
            btn.style.cssText = `
                width: 100%;
                padding: 8px 0;
                font-size: 0.8rem;
                font-weight: 600;
                border-radius: 6px;
                border: 1px solid ${borderColor};
                background-color: ${bgColor};
                color: #f1f5f9;
                cursor: pointer;
                transition: all 0.15s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                box-sizing: border-box;
            `;
            btn.onmouseover = () => btn.style.filter = 'brightness(1.15)';
            btn.onmouseout = () => btn.style.filter = 'none';
            btn.onclick = onClick;
            return btn;
        };

        // Notice (공지사항) 버튼
        const noticeBtn = createButton(
            '📢 Notice',
            '#db2777',
            '#f472b6',
            createNoticeModal,
            'btn-open-notice'
        );

        // 데이터 불러오기 버튼
        const loadDataBtn = createButton(
            '📂 데이터 불러오기',
            '#0d9488',
            '#14b8a6',
            openDataLoaderModal,
            'btn-open-data-loader'
        );

        // DB 데이터 프리셋 관리 버튼
        const dataPresetBtn = createButton(
            '📦 DB 프리셋 관리',
            '#4f46e5',
            '#6366f1',
            openDataPresetModal,
            'btn-open-db-preset'
        );

        // 비교 세팅 버튼
        const setBaseBtn = createButton('📌 비교군 저장', '#2563eb', '#3b82f6', () => {
            if (typeof window.setBaseline === 'function') window.setBaseline();
        });

        const toggleViewBtn = createButton('📊 비교표 보기', '#0284c7', '#38bdf8', () => {
            if (typeof window.openCompareModal === 'function') window.openCompareModal();
            else if (typeof openCompareModal === 'function') openCompareModal();
        });

        // 치적 시너지 입력 박스
        const synergyBox = document.createElement('div');
        synergyBox.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 6px 0;
            margin: 2px 0;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        `;

        const label = document.createElement('span');
        label.innerText = '파티 치적 시너지(본인 제외)';
        label.style.cssText = `
            color: #a5b4fc;
            font-size: 0.75rem;
            font-weight: 600;
            text-align: left;
            padding-left: 2px;
        `;

        const select = document.createElement('select');
        select.id = 'party-crit-select';
        select.style.cssText = `
            width: 100%;
            background-color: #0f172a;
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 6px;
            padding: 7px 10px;
            font-size: 0.8rem;
            font-weight: bold;
            cursor: pointer;
            outline: none;
            box-sizing: border-box;
            transition: border-color 0.15s ease;
        `;

        select.onmouseover = () => select.style.borderColor = '#38bdf8';
        select.onmouseout = () => select.style.borderColor = 'rgba(255, 255, 255, 0.15)';

        [0, 1, 2].forEach(val => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.innerText = `${val}명 (${val * 10}%)`;
            if (val === window.partyCritCount) opt.selected = true;
            select.appendChild(opt);
        });

        select.onchange = function(e) {
            window.partyCritCount = Number(e.target.value);
            if (typeof window.triggerCalculation === 'function') {
                window.triggerCalculation();
            }
        };

        synergyBox.appendChild(label);
        synergyBox.appendChild(select);

        // 에스더 결속 효과 영역
        const estherBox = document.createElement('div');
        estherBox.id = 'esther-bonding-box';
        estherBox.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding-bottom: 6px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        `;

        const estherLabel = document.createElement('span');
        estherLabel.innerText = '에스더 결속 효과';
        estherLabel.style.cssText = `
            color: #fcd34d;
            font-size: 0.75rem;
            font-weight: 600;
            text-align: left;
            padding-left: 2px;
        `;
        estherBox.appendChild(estherLabel);

        // 다중 치명타 (패치 예정 시스템) 토글: 설정은 저장해 둔다
        if (window.multiCritEnabled === undefined) {
            window.multiCritEnabled = typeof GM_getValue === 'function' ? Boolean(GM_getValue('multiCritEnabled', false)) : false;
        }
        const multiCritBtn = document.createElement('button');
        multiCritBtn.id = 'multi-crit-btn';
        multiCritBtn.type = 'button';
        multiCritBtn.title = '치명타 적중률이 100%를 넘으면 초과분만큼 추가 치명타가 발생합니다';
        multiCritBtn.style.cssText = `
            width: 100%; padding: 6px 0; font-size: 0.75rem; font-weight: bold; border-radius: 6px;
            border: 1px solid; cursor: pointer; outline: none; box-sizing: border-box; transition: all 0.15s ease;
        `;
        const updateMultiCritBtn = () => {
            const on = window.multiCritEnabled;
            multiCritBtn.innerText = on ? '💥 다중 치명타 : ON' : '💤 다중 치명타 : OFF';
            multiCritBtn.style.backgroundColor = on ? '#7c2d12' : '#0f172a';
            multiCritBtn.style.borderColor = on ? '#fb923c' : 'rgba(255, 255, 255, 0.15)';
            multiCritBtn.style.color = on ? '#ffedd5' : '#94a3b8';
        };
        updateMultiCritBtn();
        multiCritBtn.onclick = () => {
            window.multiCritEnabled = !window.multiCritEnabled;
            if (typeof GM_setValue === 'function') GM_setValue('multiCritEnabled', window.multiCritEnabled);
            updateMultiCritBtn();
            if (typeof window.triggerCalculation === 'function') window.triggerCalculation();
        };

        window.estherBonding1 = Boolean(window.estherBonding1);
        window.estherBonding2 = Boolean(window.estherBonding2);

        const updateBondingBtnStyle = (btn, isOn, label) => {
            if (isOn) {
                btn.innerText = `⚡ ${label} : ON`;
                btn.style.backgroundColor = '#78350f';
                btn.style.borderColor = '#f59e0b';
                btn.style.color = '#fef3c7';
            } else {
                btn.innerText = `💤 ${label} : OFF`;
                btn.style.backgroundColor = '#0f172a';
                btn.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                btn.style.color = '#94a3b8';
            }
        };

        const createBondingToggleBtn = (id, globalVarName, label) => {
            const btn = document.createElement('button');
            btn.id = id;
            btn.type = 'button';
            btn.style.cssText = `
                width: 100%;
                padding: 6px 0;
                font-size: 0.75rem;
                font-weight: bold;
                border-radius: 6px;
                border: 1px solid;
                cursor: pointer;
                outline: none;
                box-sizing: border-box;
                transition: all 0.15s ease;
                display: flex;
                align-items: center;
                justify-content: center;
            `;

            updateBondingBtnStyle(btn, window[globalVarName], label);

            btn.onclick = function() {
                window[globalVarName] = !window[globalVarName];
                updateBondingBtnStyle(btn, window[globalVarName], label);
                if (typeof window.triggerCalculation === 'function') {
                    window.triggerCalculation();
                }
            };

            return btn;
        };

        const btn1 = createBondingToggleBtn('esther-bonding-btn-1', 'estherBonding1', '결속 1단계');
        const btn2 = createBondingToggleBtn('esther-bonding-btn-2', 'estherBonding2', '결속 2단계');

        estherBox.appendChild(btn1);
        estherBox.appendChild(btn2);

        // 스마트 토글 버튼 UI 갱신
        const updatePauseBtnUI = (btn) => {
            if (!window.hasCalculatedOnce) {
                btn.innerText = '🚀 계산 시작';
                btn.style.backgroundColor = '#059669';
                btn.style.borderColor = '#10b981';
            } else if (window.isCalcPaused) {
                btn.innerText = '⏸️ 실시간 계산 : OFF';
                btn.style.backgroundColor = '#991b1b';
                btn.style.borderColor = '#dc2626';
            } else {
                btn.innerText = '▶️ 실시간 계산 : ON';
                btn.style.backgroundColor = '#166534';
                btn.style.borderColor = '#22c55e';
            }
        };

        const handlePauseBtnClick = () => {
            const btn = document.getElementById('calc-pause-btn');

            if (!window.hasCalculatedOnce) {
                window.hasCalculatedOnce = true;
                window.isCalcPaused = false;

                if (typeof window.triggerCalculation === 'function') {
                    window.triggerCalculation();
                } else if (typeof window.handleCalculate === 'function') {
                    window.handleCalculate();
                }
            } else {
                window.isCalcPaused = !window.isCalcPaused;
                if (!window.isCalcPaused && typeof window.triggerCalculation === 'function') {
                    window.triggerCalculation();
                }
            }

            if (btn) updatePauseBtnUI(btn);
        };

        const pauseBtn = createButton('', '', '', handlePauseBtnClick, 'calc-pause-btn');
        updatePauseBtnUI(pauseBtn);

        // 아크패시브 세팅 관리 버튼
        const presetBtn = createButton(
            '📁 아크패시브 세팅 관리',
            '#1d4ed8',
            '#60a5fa',
            () => {
                if (typeof window.openPresetModal === 'function') {
                    window.openPresetModal();
                } else if (typeof openPresetModal === 'function') {
                    openPresetModal();
                }
            },
            'calc-preset-btn'
        );

        // 패널 조립
        panel.appendChild(noticeBtn);
        panel.appendChild(loadDataBtn);
        panel.appendChild(dataPresetBtn);
        panel.appendChild(setBaseBtn);
        panel.appendChild(toggleViewBtn);
        panel.appendChild(synergyBox);
        panel.appendChild(estherBox);
        panel.appendChild(multiCritBtn);
        panel.appendChild(pauseBtn);
        panel.appendChild(presetBtn);

        document.body.appendChild(panel);

        if (typeof window.updateCoreSetUI === 'function') {
            window.updateCoreSetUI();
        }
    }

    // 스크립트로드 시 기존 저장된 트라이포드 데이터 불러오기
    (function initSelectedTripods() {
        try {
            const saved = localStorage.getItem('LOSTARK_SELECTED_TRIPODS');
            if (saved) {
                window.selectedSkillTripods = JSON.parse(saved);
            } else {
                window.selectedSkillTripods = window.selectedSkillTripods || {};
            }
        } catch (e) {
            window.selectedSkillTripods = {};
        }
    })();

    // 💡 스크립트 맨 하단에서 즉시 버튼 패널 생성
    injectPauseButton();


    /**
     * 1. 세팅 비교 고정 패널 (아크 패시브 패널과 결과 요약 사이에 항상 표시, 계산할 때마다 자동 갱신)
     */
    if (window.isCompareDockOpen === undefined) window.isCompareDockOpen = true;

    function initCompareDock() {
        if (document.getElementById('sim-compare-dock')) return;

        const dock = document.createElement('div');
        dock.id = 'sim-compare-dock';
        dock.className = 'custom-ark-panel';
        const arrow = window.isCompareDockOpen ? '▼' : '▲';
        dock.innerHTML = `
            <details id="sim-compare-details" ${window.isCompareDockOpen ? 'open' : ''}>
                <summary style="${makeSectionHeaderStyle('#38bdf8')}">
                    <span>📊 [세팅 비교] 비교군 대비 변화</span>
                    <span class="toggle-icon" style="font-size: 0.8rem; color: #94a3b8;">${arrow}</span>
                </summary>
                <div style="padding-top: 14px;">
                <style>
                    .compare-table-wrapper {
                        border: 1px solid #282237;
                        border-radius: 8px;
                        overflow: hidden;
                        background-color: #13111c;
                    }
                    .tm-compare-table {
                        width: 100%;
                        border-collapse: collapse;
                        text-align: center;
                        font-size: 0.88rem; /* 화면이 넓어졌으므로 글자 크기도 살짝 키워 가독성을 높였습니다 */
                    }
                    .tm-compare-table th {
                        background: #1a1625;
                        color: #d8b4fe;
                        padding: 10px 6px;
                        border: 1px solid #282237;
                        font-weight: 600;
                    }
                    .tm-compare-table th.header-group {
                        color: #c084fc;
                        font-size: 0.92rem;
                        background: #1f1a2e;
                    }
                    .tm-compare-table th.header-skill {
                        color: #e879f9;
                        font-size: 0.92rem;
                        vertical-align: middle;
                    }
                    .tm-compare-table td {
                        padding: 11px 8px;
                        border: 1px solid #231e30;
                        color: #e4e4e7;
                    }
                    .tm-compare-table tr:nth-child(even) {
                        background-color: #110f19;
                    }
                    .tm-compare-table tr:hover {
                        background-color: #1e192c;
                    }
                    .tm-compare-table .skill-name {
                        font-weight: bold;
                        color: #ffffff;
                        text-align: center;
                    }
                    .tm-compare-table .pos { color: #38bdf8 !important; font-weight: bold; }
                    .tm-compare-table .neg { color: #f87171 !important; font-weight: bold; }
                    .tm-compare-table .zero { color: #71717a; }
                    .cmp-seg { display:inline-flex; border:1px solid #3b2d54; border-radius:8px; overflow:hidden; }
                    .cmp-seg button { background:#13111c; color:#a1a1aa; border:none; padding:6px 12px; font-size:0.82rem; cursor:pointer; }
                    .cmp-seg button.on { background:#3b2d54; color:#fff; font-weight:bold; }
                    .cmp-save { background:#2563eb; color:#fff; border:none; border-radius:8px; padding:6px 12px; font-size:0.82rem; font-weight:bold; cursor:pointer; }
                    .cmp-legend { margin-left:auto; font-size:0.78rem; color:#a1a1aa; display:flex; align-items:center; gap:6px; }
                    .cmp-legend i { display:inline-block; width:10px; height:10px; border-radius:2px; }
                    #compareChart { position:relative; }
                    .cmp-plot { display:flex; align-items:flex-end; gap:6px; height:260px; padding:22px 4px 0; border-bottom:1px solid #3b2d54; }
                    .cmp-col { flex:1 1 0; min-width:0; height:100%; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; border-radius:6px 6px 0 0; }
                    .cmp-col:hover { background:#1e192c; }
                    .cmp-diff { font-size:0.74rem; font-weight:bold; white-space:nowrap; margin-bottom:3px; }
                    .cmp-diff.pos { color:#38bdf8; } .cmp-diff.neg { color:#f87171; } .cmp-diff.zero { color:#71717a; }
                    .cmp-pair { display:flex; align-items:flex-end; gap:2px; width:100%; justify-content:center; }
                    .cmp-bar { width:38%; max-width:26px; min-height:2px; border-radius:4px 4px 0 0; transition:height .25s; }
                    .cmp-bar.base { background:#6b5b95; }
                    .cmp-bar.curr { background:#38bdf8; }
                    .cmp-labels { display:flex; gap:6px; padding:6px 4px 0; }
                    .cmp-name { flex:1 1 0; min-width:0; font-size:0.76rem; font-weight:600; color:#e4e4e7; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                    #cmp-tooltip { position:absolute; display:none; z-index:5; pointer-events:none; background:#1a1625; border:1px solid #5b4a82; border-radius:8px; padding:8px 10px; font-size:0.78rem; line-height:1.5; color:#e4e4e7; box-shadow:0 6px 18px rgba(0,0,0,.6); white-space:nowrap; }
                </style>
                <!-- 보기 전환 / 지표 선택 -->
                <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px; flex-wrap:wrap;">
                    <div class="cmp-seg" id="cmp-view-seg">
                        <button data-view="chart">📊 그래프</button><button data-view="table">📋 표</button>
                    </div>
                    <div class="cmp-seg" id="cmp-metric-seg">
                        <button data-metric="dmg">데미지</button><button data-metric="dps">DPS</button><button data-metric="cd">쿨타임</button>
                    </div>
                    <button id="cmp-save-baseline" class="cmp-save">📌 비교군 저장</button>
                    <div class="cmp-legend"><i style="background:#6b5b95"></i>비교군 <i style="background:#38bdf8"></i>지금 세팅</div>
                </div>
                <div id="compareChart"></div>

                <!-- 2단 구조 비교 테이블 -->
                <div class="compare-table-wrapper" id="compareTableWrapper">
                    <table class="tm-compare-table">
                        <thead>
                            <tr>
                                <th rowspan="2" class="header-skill" style="width: 16%;">스킬명</th>
                                <th colspan="2" class="header-group" style="width: 28%;">비교군</th>
                                <th colspan="2" class="header-group" style="width: 28%;">지금 세팅</th>
                                <th colspan="3" class="header-group" style="width: 28%;">변화율</th>
                            </tr>
                            <tr>
                                <th>기대값</th>
                                <th>쿨타임</th>
                                <th>기대값</th>
                                <th>쿨타임</th>
                                <th>데미지증감</th>
                                <th>쿨타임증감</th>
                                <th>DPS증감</th>
                            </tr>
                        </thead>
                        <tbody id="compareTableBody">
                            <tr><td colspan="8" style="padding: 30px; color: #71717a;">데이터를 연산하는 중입니다...</td></tr>
                        </tbody>
                    </table>
                </div>
                </div>
            </details>
        `;

        const arkPanel = document.getElementById('arkPassiveModal');
        if (arkPanel) arkPanel.insertAdjacentElement('afterend', dock);
        else document.body.appendChild(dock);

        const details = dock.querySelector('#sim-compare-details');
        details.ontoggle = function() {
            window.isCompareDockOpen = this.open;
            const icon = this.querySelector('.toggle-icon');
            if (icon) icon.textContent = this.open ? '▼' : '▲';
            if (this.open) renderCompareTable();
        };
        dock.querySelectorAll('#cmp-view-seg button').forEach(b => b.onclick = () => { compareView = b.dataset.view; renderCompareTable(); });
        dock.querySelectorAll('#cmp-metric-seg button').forEach(b => b.onclick = () => { compareMetric = b.dataset.metric; renderCompareTable(); });
        dock.querySelector('#cmp-save-baseline').onclick = () => window.setBaseline();

        renderCompareTable();
    }

    // 플로팅 메뉴의 [비교표 보기] 버튼: 고정 패널을 펼치고 그 위치로 이동
    function openCompareModal() {
        initCompareDock();
        const details = document.getElementById('sim-compare-details');
        if (details && !details.open) details.open = true;
        renderCompareTable();
        const dock = document.getElementById('sim-compare-dock');
        if (dock) dock.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /**
     * 2. 아크 패시브 세팅 관리 모달 팝업 생성 및 오픈
     */
    function openPresetModal() {
        let modal = document.getElementById('preset-modal');
        if (modal) {
            modal.style.display = 'flex';
            window.renderPresetList();
            return;
        }

        modal = document.createElement('div');
        modal.id = 'preset-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.7); z-index: 1000000;
            display: flex; align-items: center; justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        modal.innerHTML = `
            <div style="background: #1e2029; border: 1px solid #333745; width: 380px; padding: 20px; border-radius: 12px; color: #fff; box-shadow: 0 10px 25px rgba(0,0,0,0.6);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 14px;">
                    <h3 style="margin:0; font-size: 1.05rem; color: #60a5fa; display:flex; align-items:center; gap:6px;">
                        ⚡ 아크 패시브 세팅 관리
                    </h3>
                    <button id="modal-close-btn" style="background:none; border:none; color:#aaa; cursor:pointer; font-size:1.2rem; line-height:1;">✕</button>
                </div>

                <div style="display:flex; gap:6px; margin-bottom: 16px;">
                    <input id="preset-name-input" type="text" placeholder="세팅 이름 (예: 깨달음 딜러)" style="flex:1; padding: 7px 10px; background:#0f1015; border:1px solid #333745; color:#fff; border-radius:6px; font-size:0.85rem; outline:none;" />
                    <button id="preset-save-btn" style="padding: 7px 14px; background:#22c55e; border:none; color:#fff; font-weight:bold; font-size:0.8rem; border-radius:6px; cursor:pointer;">저장</button>
                </div>

                <div id="preset-list-container" style="max-height: 220px; overflow-y: auto; display:flex; flex-direction:column; gap:6px; padding-right:2px;">
                    <!-- 세팅 목록이 동적으로 들어가는 위치 -->
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // X 닫기 버튼 이벤트
        document.getElementById('modal-close-btn').onclick = () => {
            modal.style.display = 'none';
        };

        // 저장 버튼 클릭 이벤트
        document.getElementById('preset-save-btn').onclick = () => {
            const input = document.getElementById('preset-name-input');
            const val = input.value.trim();
            if (typeof window.savePreset === 'function') {
                window.savePreset(val);
            }
            input.value = '';
            window.renderPresetList();
        };

        window.renderPresetList();
    }

    /**
     * 3. 프리셋 목록 리플레이서 (이벤트 직접 바인딩으로 안전성 확보)
     */
    window.renderPresetList = function() {
        const container = document.getElementById('preset-list-container');
        if (!container) return;

        const presets = getPresetList();
        const keys = Object.keys(presets);

        container.innerHTML = ''; // 초기화

        if (keys.length === 0) {
            container.innerHTML = `<div style="text-align:center; color:#6b7280; font-size:0.8rem; padding:16px;">저장된 아크 패시브 세팅이 없습니다.</div>`;
            return;
        }

        keys.forEach(name => {
            const itemEl = document.createElement('div');
            itemEl.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:#111217; padding: 8px 12px; border-radius:6px; border:1px solid #222530;';

            const infoBox = document.createElement('div');
            infoBox.innerHTML = `
                <div style="font-size:0.85rem; font-weight:bold; color:#f3f4f6;">${name}</div>
                <div style="font-size:0.7rem; color:#6b7280;">${presets[name].savedAt || ''}</div>
            `;

            const btnGroup = document.createElement('div');
            btnGroup.style.cssText = 'display:flex; gap:6px;';

            // 불러오기 버튼
            const loadBtn = document.createElement('button');
            loadBtn.innerText = '불러오기';
            loadBtn.style.cssText = 'padding:4px 10px; background:#3b82f6; border:none; color:#fff; font-size:0.75rem; font-weight:bold; border-radius:4px; cursor:pointer;';
            loadBtn.onclick = function() {
                if (typeof window.applyPreset === 'function') {
                    window.applyPreset(name);
                }
                const modal = document.getElementById('preset-modal');
                if (modal) modal.style.display = 'none';
            };

            // 삭제 버튼
            const delBtn = document.createElement('button');
            delBtn.innerText = '삭제';
            delBtn.style.cssText = 'padding:4px 8px; background:#ef4444; border:none; color:#fff; font-size:0.75rem; border-radius:4px; cursor:pointer;';
            delBtn.onclick = function() {
                if (typeof window.deletePreset === 'function') {
                    window.deletePreset(name);
                }
                window.renderPresetList();
            };

            btnGroup.appendChild(loadBtn);
            btnGroup.appendChild(delBtn);

            itemEl.appendChild(infoBox);
            itemEl.appendChild(btnGroup);

            container.appendChild(itemEl);
        });
    };

    // =============================================================================
    // 7. 메인 실행 핸들러 및 트리거 버튼 생성
    // =============================================================================
    function handleCalculate() {
        try {
            const rawData = extractFullSimulatorData(document);

            // 🔍 [1단계] DOM 파싱(불러오기) 확인

            const mappedInputs = mapExtractedDataToInputs(rawData);
            const finalInputs = transformToInputs(mappedInputs);
            const results = calculateSkillStats(finalInputs);

            lastCalculatedResults = results;


            renderResultsHTML(results);
            renderCompareTable(); // 고정 비교 패널 실시간 갱신
        } catch (err) {
            console.error("연산 처리 중 오류 발생:", err);
            showAlert("연산 도중 오류가 발생했습니다. 콘솔 창(F12)을 확인해주세요.");
            toggleCalcPause()
        }
    }

    const PRESET_STORAGE_KEY = 'ARK_CALC_PASSIVE_PRESETS';

    /**
     * 1. 현재 화면의 아크 패시브 설정만 수집
     */
    function getPassiveState() {
        const container = document.getElementById('arkEvolutionContainer');

        if (!container) {
            console.error("아크 패시브 영역(#arkEvolutionContainer)을 찾을 수 없습니다.");
            return { timestamp: new Date().toLocaleString(), nodes: {} };
        }

        const nodesData = {};
        const nodes = container.querySelectorAll('.ark-node');

        nodes.forEach(node => {
            // 노드 이름 추출 (span 태그의 텍스트)
            const nameSpan = node.querySelector('span');
            if (!nameSpan) return;

            const nodeName = nameSpan.textContent.trim();

            // 수치 추출 ("15/30" 형식의 span 태그)
            const pointSpan = node.querySelector('.node-controls span');
            if (pointSpan) {
                const [current, max] = pointSpan.textContent.split('/').map(v => parseInt(v.trim(), 10));
                nodesData[nodeName] = {
                    current: isNaN(current) ? 0 : current,
                    max: isNaN(max) ? 0 : max
                };
            }
        });

        return {
            timestamp: new Date().toLocaleString(),
            nodes: nodesData
        };
    }

    /**
     * 2. 아크 패시브 프리셋 저장
     */
    window.savePreset = function(presetName) {
        if (!presetName) return showAlert('프리셋 이름을 입력해 주세요!');

        const presets = getPresetList();
        const currentState = getPassiveState();

        presets[presetName] = {
            name: presetName,
            data: currentState, // nodes 데이터를 포함한 전체 객체 저장
            savedAt: new Date().toLocaleDateString()
        };

        localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
        showAlert(`'${presetName}' 아크 패시브 세팅이 저장되었습니다!`);
    };


    /**
     * 3. 아크 패시브 프리셋 불러오기 (전체 초기화 후 티어 순서대로 복원)
     */
    window.applyPreset = function(presetName) {
        const presets = getPresetList();
        const target = presets[presetName];
        if (!target) return showAlert('존재하지 않는 프리셋입니다.');

        const nodesData = target.data?.nodes || target.data || {};
        const container = document.getElementById('arkEvolutionContainer');

        if (!container) {
            return showAlert(`아크 패시브 영역(#arkEvolutionContainer)을 화면에서 찾을 수 없습니다.`);
        }

        // [STEP 1] 아크 패시브 전체 초기화 수행
        // 1-1. 화면 내 '초기화' 버튼이 있는지 찾고 클릭
        const allButtons = Array.from(container.querySelectorAll('button'));
        const resetButton = allButtons.find(btn =>
            btn.textContent.includes('초기화') ||
            btn.classList.contains('btn-reset') ||
            btn.getAttribute('title')?.includes('초기화')
        );

        if (resetButton) {
            resetButton.click();
        } else {
            // 1-2. 초기화 버튼이 없을 경우: 아래->위 순서로 minus 버튼을 연속 클릭하여 0으로 리셋
            const nodesArray = Array.from(container.querySelectorAll('.ark-node')).reverse();
            nodesArray.forEach(node => {
                const minusBtn = node.querySelector('.btn-minus, [data-action="minus"], .node-controls button:first-child');
                if (minusBtn) {
                    for (let i = 0; i < 30; i++) {
                        minusBtn.click();
                    }
                }
            });
        }

        // [STEP 2] 1티어 -> 2티어 -> 3티어 순서(DOM 순서)대로 포인트 투자
        const nodes = container.querySelectorAll('.ark-node');

        nodes.forEach(node => {
            const nameSpan = node.querySelector('span');
            if (!nameSpan) return;

            const nodeName = nameSpan.textContent.trim();
            const targetData = nodesData[nodeName];

            if (targetData && targetData.current > 0) {
                const plusBtn = node.querySelector('.btn-plus, [data-action="plus"], .node-controls button:last-child');
                if (plusBtn) {
                    // 목표 포인트 수치만큼 + 버튼 클릭
                    for (let i = 0; i < targetData.current; i++) {
                        plusBtn.click();
                    }
                }
            }
        });

        // [STEP 3] 최종 계산 재트리거
        setTimeout(() => {
            if (typeof window.triggerCalculation === 'function') {
                window.triggerCalculation();
            }
        }, 100);

        showAlert(`'${presetName}' 아크 패시브 세팅을 불러왔습니다!`);
    };

    /**
     * 4. 유틸리티 함수들 (목록 조회/삭제)
     */
    function getPresetList() {
        try { return JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY)) || {}; }
        catch (e) { return {}; }
    }

    window.deletePreset = function(presetName) {
        const presets = getPresetList();
        delete presets[presetName];
        localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
    };

        // 기존 createTriggerButton()을 대체하는 실시간 계산 및 초기화 함수
    function initRealtimeCalculator() {
        // 1. 하단 아크패시브 패널 생성
        // 화면 배치(위→아래): 스킬&트라이포드 → 아크 패시브(진화) → 세팅 비교 → 결과 요약
        initSkillTripodPanel();
        initArkPassivePanel();
        initCompareDock();
        const emptyTables = Object.keys(GAME_DATA_TABLES).filter(k => {
            const t = GAME_DATA_TABLES[k];
            return Array.isArray(t) ? t.length === 0 : Object.keys(t).length === 0;
        });
        if (emptyTables.length) {
            console.warn('[게임 데이터] 비어 있는 표:', emptyTables.join(', '));
            showAlert('게임 데이터가 비어 있습니다: ' + emptyTables.join(', ') + '\n[데이터 불러오기] > [5. 게임 데이터]에서 JSON을 업로드하세요.');
        }
        let calcTimer = null;

        // 실시간 계산 실행 함수 (디바운스 & requestAnimationFrame 적용)
        window.triggerCalculation = function() {
            if (window.isCalcPaused) return;
            clearTimeout(calcTimer);
            calcTimer = setTimeout(() => {
                if (typeof handleCalculate === 'function') {
                    requestAnimationFrame(() => {
                        handleCalculate();
                    });
                }
            }, 500); // 반응성을 위해 100ms -> 80ms로 살짝 단축
        };

        // 2. [핵심 수정 1] 특정 모달이 아닌 document 전역(body)에 이벤트 바인딩
        const eventTypes = ['input', 'change', 'click', 'keyup'];

        eventTypes.forEach(eventType => {
            document.body.addEventListener(eventType, (e) => {
                const target = e.target;
                // 비교 패널 조작(지표 전환 등)은 재계산 대상이 아님
                if (target.closest && target.closest('#sim-compare-dock')) return;
                // input, select, textarea, checkbox, radio, button 및 클릭 가능한 요소 감지
                if (
                    target.matches('input, select, textarea, [type="checkbox"], [type="radio"], button, .btn-node, .ark-icon') ||
                    target.closest('.sim-skill-row')
                ) {
                    window.triggerCalculation();
                }
            }, true); // 캡처링 모드(true)로 event.stopPropagation() 이벤트 차단 방지
        });

        // 3. [핵심 수정 2] React 등 프레임워크에 의해 DOM 상태/속성이 변경될 때도 감지 (MutationObserver)
        // 이 스크립트가 만든 표시 전용 UI(결과창/모달/알림창)의 변화는 입력 변경이 아니므로 무시한다 (무한 루프 방지 포함)
        const IGNORED_UI_SELECTOR = [
            '#sim-result-section', '#sim-result-modal', '#sim-mini-modal', '#calc-compare-modal', '#sim-compare-dock',
            '#preset-modal', '#data-preset-modal', '#data-loader-modal', '#calc-notice-modal',
            '#customAlertOverlay', '#customConfirmOverlay', '.custom-alert-overlay', '.custom-confirm-overlay'
        ].join(',');
        // 입력 변경 감시 대상 속성. 'title'은 OptionPicker(장신구/팔찌 옵션) 문구 변경용.
        // 감지가 안 되는 상태가 있으면 여기에 속성을 추가하세요.
        const OBSERVED_ATTRIBUTES = ['value', 'checked', 'selected', 'class', 'title'];

        const observer = new MutationObserver((mutations) => {
            const shouldRecalc = mutations.some(mutation => {
                const el = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
                return !(el && el.closest(IGNORED_UI_SELECTOR));
            });
            if (shouldRecalc) window.triggerCalculation();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: OBSERVED_ATTRIBUTES
        });

        // 4. 최초 1회 즉시 실행
        window.triggerCalculation();
        }
        // createTriggerButton 호출부 또는 load 이벤트 바인딩 부분 수정
        window.addEventListener('load', () => {
            // React 하이드레이션 처리가 끝날 시간을 벌어줌 (100~300ms)
            setTimeout(() => {
                initRealtimeCalculator();
            }, 300);

        }
    )


    /**
     * 메인 결과창이 화면에 안 보일 때 [캐릭터 공통 세팅 지표]만 플로팅으로 보여주는 함수
     */
    function updateMiniResultModal(commonMetricsHtml) {
        let miniModal = document.getElementById('sim-mini-modal');

        // 1. 미니 모달 프레임이 없으면 새로 생성
        if (!miniModal) {
            miniModal = document.createElement('div');
            miniModal.id = 'sim-mini-modal';
            miniModal.style.cssText = `
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 99999;
                background: rgba(15, 16, 21, 0.92);
                backdrop-filter: blur(10px);
                border: 1px solid #3b4252;
                border-radius: 12px;
                padding: 14px 18px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
                color: #e2e8f0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                transition: opacity 0.25s ease, transform 0.25s ease;
                opacity: 0;
                transform: translateY(20px);
                pointer-events: none;
                max-width: 90vw;
            `;
            document.body.appendChild(miniModal);

            setupResultObserver();
        }

        // 2. 미니 모달 내부 HTML 업데이트
        miniModal.innerHTML = `
            <div style="font-size: 11px; font-weight: bold; color: #c084fc; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                <span>⚡ 캐릭터 공통 세팅 지표 (실시간)</span>
            </div>
            <div class="mini-metrics-wrapper">
                ${commonMetricsHtml}
            </div>
            <style>
                /* 미니 모달 내부에서는 Grid를 Flex로 변경하여 조그맣고 가로로 콤팩트하게 표시 */
                #sim-mini-modal .mini-metrics-wrapper > div {
                    display: flex !important;
                    flex-wrap: wrap !important;
                    gap: 8px !important;
                    margin-bottom: 0 !important;
                }
                #sim-mini-modal .mini-metrics-wrapper > div > div {
                    padding: 6px 10px !important;
                    background: #181920 !important;
                    border: 1px solid #2e323d !important;
                    border-radius: 6px !important;
                    min-width: fit-content !important;
                }
                #sim-mini-modal .mini-metrics-wrapper div {
                    font-size: 0.75rem !important;
                }
            </style>
        `;
    }
    /**
     * 하단 메인 결과창이 화면 보기에 들어왔는지/나갔는지 감지하는 Observer
     */
    function setupResultObserver() {
        const resultSection = document.getElementById('sim-result-section');
        const miniModal = document.getElementById('sim-mini-modal');
        if (!resultSection || !miniModal) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                // 메인 결과 섹션이 화면에서 벗어났을 때만 미니 모달 표시
                if (!entry.isIntersecting) {
                    miniModal.style.opacity = '1';
                    miniModal.style.transform = 'translateY(0)';
                    miniModal.style.pointerEvents = 'auto';
                } else {
                    // 메인 결과 섹션이 화면에 보이면 미니 모달 숨김
                    miniModal.style.opacity = '0';
                    miniModal.style.transform = 'translateY(20px)';
                    miniModal.style.pointerEvents = 'none';
                }
            });
        }, { threshold: 0.1 }); // 메인 결과창이 10% 이상 보이면 작동

        observer.observe(resultSection);
    }

    /**
     * 커스텀 알림창 UI 자동 생성 및 표시 함수
     */
    function showAlert(msg, icon = '🔔') {
        let overlay = document.getElementById('customAlertOverlay');

        // 1. 알림창 DOM 요소가 없으면 동적으로 자동 생성
        if (!overlay) {
            // Style 태그 주입
            const style = document.createElement('style');
            style.innerText = `
                .custom-alert-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    background-color: rgba(0, 0, 0, 0.75);
                    backdrop-filter: blur(5px);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 2147483647; /* 🌟 브라우저 최상단 최댓값으로 설정 */
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.2s ease-in-out;
                }
                .custom-alert-overlay.active {
                    opacity: 1;
                    visibility: visible;
                }
                .custom-alert-box {
                    background-color: #121318;
                    color: #ffffff;
                    width: 320px;
                    padding: 24px 20px 20px 20px;
                    border-radius: 16px;
                    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
                    text-align: center;
                    border: 1px solid #2e323d;
                    transform: scale(0.9);
                    transition: transform 0.2s ease-in-out;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                .custom-alert-overlay.active .custom-alert-box {
                    transform: scale(1);
                }
                .custom-alert-icon {
                    font-size: 32px;
                    margin-bottom: 12px;
                    line-height: 1;
                }
                .custom-alert-message {
                    font-size: 14px;
                    font-weight: 500;
                    color: #e2e8f0;
                    margin-bottom: 20px;
                    word-break: keep-all;
                    line-height: 1.5;
                }
                .custom-alert-btn {
                    width: 100%;
                    padding: 10px 0;
                    background-color: #8b5cf6;
                    color: #ffffff;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: background-color 0.15s ease;
                    box-shadow: 0 2px 8px rgba(139, 92, 246, 0.4);
                }
                .custom-alert-btn:hover {
                    background-color: #7c3aed;
                }
            `;
            document.head.appendChild(style);

            // Overlay & Box HTML 구성
            overlay = document.createElement('div');
            overlay.id = 'customAlertOverlay';
            overlay.className = 'custom-alert-overlay';
            overlay.innerHTML = `
                <div class="custom-alert-box">
                    <div class="custom-alert-icon" id="customAlertIcon">${icon}</div>
                    <div class="custom-alert-message" id="customAlertMsg"></div>
                    <button class="custom-alert-btn" id="customAlertBtn">확인</button>
                </div>
            `;
            document.body.appendChild(overlay);

            // 닫기 함수
            const closeAlert = () => {
                overlay.classList.remove('active');
            };

            // 확인 버튼 클릭 시 닫기
            document.getElementById('customAlertBtn').onclick = closeAlert;

            // 배경 클릭 시 닫기
            overlay.onclick = (e) => {
                if (e.target === overlay) closeAlert();
            };
        }

        // 2. 🌟 호출할 때마다 DOM 최하단으로 재배치하여 항상 렌더링 최상위에 오도록 처리
        document.body.appendChild(overlay);

        // 3. 메시지 및 아이콘 설정 후 팝업 출력
        document.getElementById('customAlertIcon').innerText = icon;
        document.getElementById('customAlertMsg').innerText = msg;
        overlay.classList.add('active');
    }

    function showConfirm(msg, onConfirm, icon = '❓') {
        let overlay = document.getElementById('customConfirmOverlay');

        if (!overlay) {
            const style = document.createElement('style');
            style.innerText = `
                .custom-confirm-overlay {
                    position: fixed;
                    top: 0; left: 0; width: 100vw; height: 100vh;
                    background-color: rgba(0, 0, 0, 0.75);
                    backdrop-filter: blur(5px);
                    display: flex; justify-content: center; align-items: center;
                    z-index: 2147483647;
                    opacity: 0; visibility: hidden;
                    transition: all 0.2s ease-in-out;
                }
                .custom-confirm-overlay.active {
                    opacity: 1; visibility: visible;
                }
                .custom-confirm-box {
                    background-color: #121318;
                    color: #ffffff;
                    width: 320px;
                    padding: 24px 20px 20px 20px;
                    border-radius: 16px;
                    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
                    text-align: center;
                    border: 1px solid #2e323d;
                    transform: scale(0.9);
                    transition: transform 0.2s ease-in-out;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                .custom-confirm-overlay.active .custom-confirm-box {
                    transform: scale(1);
                }
                .custom-confirm-icon {
                    font-size: 32px;
                    margin-bottom: 12px;
                    line-height: 1;
                }
                .custom-confirm-message {
                    font-size: 14px;
                    font-weight: 500;
                    color: #e2e8f0;
                    margin-bottom: 20px;
                    word-break: keep-all;
                    line-height: 1.5;
                }
                .custom-confirm-btn-group {
                    display: flex;
                    gap: 8px;
                }
                .custom-confirm-btn {
                    flex: 1;
                    padding: 10px 0;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: background-color 0.15s ease;
                }
                .custom-confirm-btn-cancel {
                    background-color: #334155;
                    color: #cbd5e1;
                }
                .custom-confirm-btn-cancel:hover {
                    background-color: #475569;
                }
                .custom-confirm-btn-ok {
                    background-color: #dc2626;
                    color: #ffffff;
                    box-shadow: 0 2px 8px rgba(220, 38, 38, 0.4);
                }
                .custom-confirm-btn-ok:hover {
                    background-color: #b91c1c;
                }
            `;
            document.head.appendChild(style);

            overlay = document.createElement('div');
            overlay.id = 'customConfirmOverlay';
            overlay.className = 'custom-confirm-overlay';
            overlay.innerHTML = `
                <div class="custom-confirm-box">
                    <div class="custom-confirm-icon" id="customConfirmIcon">${icon}</div>
                    <div class="custom-confirm-message" id="customConfirmMsg"></div>
                    <div class="custom-confirm-btn-group">
                        <button class="custom-confirm-btn custom-confirm-btn-cancel" id="customConfirmCancelBtn">취소</button>
                        <button class="custom-confirm-btn custom-confirm-btn-ok" id="customConfirmOkBtn">확인</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        }

        document.body.appendChild(overlay);

        document.getElementById('customConfirmIcon').innerText = icon;
        document.getElementById('customConfirmMsg').innerText = msg;

        const closeConfirm = () => {
            overlay.classList.remove('active');
        };

        // [확인] 버튼 클릭
        document.getElementById('customConfirmOkBtn').onclick = () => {
            closeConfirm();
            if (typeof onConfirm === 'function') onConfirm();
        };

        // [취소] 버튼 및 배경 클릭
        document.getElementById('customConfirmCancelBtn').onclick = closeConfirm;
        overlay.onclick = (e) => {
            if (e.target === overlay) closeConfirm();
        };

        overlay.classList.add('active');
    }

    /**
     * 커스텀 알림창 닫기
     */
    function closeAlert() {
        const overlay = document.getElementById('customAlertOverlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
    }
})();
