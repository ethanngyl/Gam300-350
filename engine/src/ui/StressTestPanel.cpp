#include "StressTestPanel.h"

#include "splat/SplatGenerator.h"

#include <QBrush>
#include <QColor>
#include <QFont>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QLabel>
#include <QLocale>
#include <QPushButton>
#include <QSpinBox>
#include <QTableWidget>
#include <QVBoxLayout>

namespace {
	//Row colors, one per test. Dark and muted so the light table text stays readable on the dark theme
	const QColor kTestColors[] = {
		QColor(0x2b, 0x4a, 0x6f), //Blue
		QColor(0x2f, 0x5c, 0x3e), //Green
		QColor(0x6b, 0x55, 0x1f), //Amber
		QColor(0x5e, 0x3a, 0x6e), //Purple
		QColor(0x1f, 0x5f, 0x5f), //Teal
		QColor(0x6e, 0x3a, 0x3a), //Red
		QColor(0x55, 0x62, 0x2a), //Olive
		QColor(0x70, 0x2f, 0x5a), //Magenta
	};
	constexpr int kTestColorCount = static_cast<int>(sizeof(kTestColors) / sizeof(kTestColors[0]));

	//Failed rows are a stronger red than any test color, so they stand out from all of them
	const QColor kFailColor(0xb4, 0x1e, 0x1e);

	//Data stored on the first cell of every row (Qt::UserRole itself holds the failed flag)
	constexpr int kGroupRole = Qt::UserRole + 1;    //int, which test's rows this is, -1 for a row with no group
	constexpr int kTotalRole = Qt::UserRole + 2;    //bool, true for the row that collapses and expands its group
	constexpr int kBaseNameRole = Qt::UserRole + 3; //QString, the total row's name without the arrow

	//If new results start with their rows hidden, showing only the total. Set to false to start them open
	constexpr bool kCollapseByDefault = true;

	//The arrow in front of a total row's name, pointing down while its rows are shown and right while they are hidden
	QString TotalLabel(const QString& baseName, bool collapsed) {
		return QString(QChar(collapsed ? 0x25B8 : 0x25BE)) + QLatin1Char(' ') + baseName;
	}

	//A splat is 64 bytes and the tests copy the splats several times
	//Min limits of the splat count box
	constexpr int kMinSplatCount = 1000;
	//Max limits of the splat count box
	constexpr int kMaxSplatCount = 10000000;
}

StressTestPanel::StressTestPanel(QWidget* parent)
	: QWidget(parent)
{
	//Widgets must be heap allocated with a parent, a stack object is destroyed when the constructor returns
	//Layout manager
	auto* layout = new QVBoxLayout(this);

	auto* buttonRow = new QHBoxLayout();     //Run everything, plus the splat count and the result controls
	auto* buttonRow2nd = new QHBoxLayout();  //One button per test, each runs on the selected model
	auto* testAllButton = new QPushButton("Test All", this);
	testAllButton->setToolTip("Loads a new test sphere, then runs every test on it. Your own models are not touched.");
	auto* testAllCurrentButton = new QPushButton("Test All (Current)", this);
	testAllCurrentButton->setToolTip("Runs every test on the model that is selected now, whichever it is. Load saves a temporary "
		"copy of it and loads that back. Each test puts the model back as it was. The Splats box is not used.");
	auto* loadTestButton = new QPushButton("Load Test", this);
	auto* selectTestButton = new QPushButton("Select Test", this);
	auto* moveTestButton = new QPushButton("Move Test", this);
	auto* trimTestButton = new QPushButton("Trim Test", this);
	auto* deleteTestButton = new QPushButton("Delete Test", this);
	auto* undoRedoTestButton = new QPushButton("Undo/Redo Test", this);
	auto* exportTestButton = new QPushButton("Export Test", this);
	auto* clearButton = new QPushButton("Clear Results", this);
	buttonRow->addWidget(testAllButton);
	buttonRow->addWidget(testAllCurrentButton);

	//The single tests run on whichever model is selected, so a real model can be tested on purpose
	buttonRow2nd->addWidget(loadTestButton);
	buttonRow2nd->addWidget(selectTestButton);
	buttonRow2nd->addWidget(moveTestButton);
	buttonRow2nd->addWidget(trimTestButton);
	buttonRow2nd->addWidget(deleteTestButton);
	buttonRow2nd->addWidget(undoRedoTestButton);
	buttonRow2nd->addWidget(exportTestButton);
	buttonRow2nd->addStretch();

	m_stopButton = new QPushButton("Stop", this);
	m_stopButton->setToolTip("Stops Test All after the test that is running finishes");
	m_stopButton->setEnabled(false); //Only usable during Test All
	buttonRow->addWidget(m_stopButton);
	buttonRow->addStretch(); //Keeps the buttons at their normal size instead of stretching across the dock

	//Size of the sphere the Load Test and Test All generate
	buttonRow->addWidget(new QLabel("Splats:", this));
	m_splatCount = new QSpinBox(this);
	m_splatCount->setRange(kMinSplatCount, kMaxSplatCount);
	m_splatCount->setSingleStep(100000);
	m_splatCount->setValue(static_cast<int>(splat_generate::kStressTestSplatCount));
	m_splatCount->setGroupSeparatorShown(true); //1,000,000 instead of 1000000
	m_splatCount->setToolTip("How many splats the test sphere has. Large values use a lot of memory, "
		"the move, delete and undo tests make several copies of the splats.");
	buttonRow->addWidget(m_splatCount);

	//Not in m_runButtons, they do not start a test so they stay usable while one runs
	auto* collapseAllButton = new QPushButton("Collapse All", this);
	collapseAllButton->setToolTip("Hides every test's rows and leaves its total. Failed rows stay visible.");
	auto* expandAllButton = new QPushButton("Expand All", this);
	expandAllButton->setToolTip("Shows every test's rows again. Double-click a total row to do one test.");
	buttonRow->addWidget(collapseAllButton);
	buttonRow->addWidget(expandAllButton);
	buttonRow->addWidget(clearButton);
	m_runButtons = { testAllButton, testAllCurrentButton, loadTestButton, selectTestButton, moveTestButton, trimTestButton,
		deleteTestButton, undoRedoTestButton, exportTestButton, clearButton };

	layout->addLayout(buttonRow);
	layout->addLayout(buttonRow2nd);

	//Stays visible until Clear Results, so a failure is not missed even if the row has scrolled out of view
	m_failureBanner = new QLabel(this);
	m_failureBanner->setStyleSheet("background-color: #b41e1e; color: white; font-weight: bold; padding: 4px;");
	m_failureBanner->setWordWrap(true);
	m_failureBanner->setVisible(false);
	layout->addWidget(m_failureBanner);

	//Table
	m_results = new QTableWidget(0, 3, this);
	m_results->setHorizontalHeaderLabels({ "Test", "Splats", "Time (ms)" }); //Table header labels
	m_results->horizontalHeader()->setSectionResizeMode(0, QHeaderView::Stretch);
	m_results->setEditTriggers(QAbstractItemView::NoEditTriggers);
	m_results->setSelectionBehavior(QAbstractItemView::SelectRows);
	layout->addWidget(m_results);

	//Explains the selected row, always visible unlike a hover tooltip
	m_description = new QLabel(this);
	m_description->setObjectName("PanelHint"); //Same hint style as the other panels
	m_description->setWordWrap(true);
	layout->addWidget(m_description);
	ShowSelectedDescription();

	connect(m_results, &QTableWidget::itemSelectionChanged, this, [this] { ShowSelectedDescription(); });
	connect(testAllButton, &QPushButton::clicked, this, &StressTestPanel::testAllRequested);
	connect(testAllCurrentButton, &QPushButton::clicked, this, &StressTestPanel::testAllCurrentRequested);
	connect(m_stopButton, &QPushButton::clicked, this, &StressTestPanel::stopRequested);
	connect(loadTestButton, &QPushButton::clicked, this, &StressTestPanel::loadTestRequested);
	connect(selectTestButton, &QPushButton::clicked, this, &StressTestPanel::selectTestRequested);
	connect(moveTestButton, &QPushButton::clicked, this, &StressTestPanel::moveTestRequested);
	connect(trimTestButton, &QPushButton::clicked, this, &StressTestPanel::trimTestRequested);
	connect(exportTestButton, &QPushButton::clicked, this, &StressTestPanel::exportTestRequested);
	connect(deleteTestButton, &QPushButton::clicked, this, &StressTestPanel::deleteTestRequested);
	connect(undoRedoTestButton, &QPushButton::clicked, this, &StressTestPanel::undoRedoTestRequested);
	connect(collapseAllButton, &QPushButton::clicked, this, [this] { SetAllGroupsCollapsed(true); });
	connect(expandAllButton, &QPushButton::clicked, this, [this] { SetAllGroupsCollapsed(false); });
	//Double-clicking a total row collapses or expands the rows of its test
	connect(m_results, &QTableWidget::cellDoubleClicked, this, [this](int row, int) {
		const QTableWidgetItem* first = m_results->item(row, 0);
		if (first && first->data(kTotalRole).toBool()) {
			const int group = first->data(kGroupRole).toInt();
			if (group >= 0) {
				SetGroupCollapsed(group, !m_collapsedGroups.contains(group));
			}
		}
	});
	connect(clearButton, &QPushButton::clicked, this, [this] {
		m_results->setRowCount(0);
		m_collapsedGroups.clear();
		m_nextGroup = 0;
		m_failedCount = 0;
		m_failureBanner->setVisible(false);
		ShowSelectedDescription(); //Nothing is selected any more
	});
}

StressTestPanel::~StressTestPanel() = default;

void StressTestPanel::SetRunning(bool running, bool stoppable) {
	for (QPushButton* button : m_runButtons) {
		button->setEnabled(!running);
	}
	m_splatCount->setEnabled(!running);
	m_stopButton->setEnabled(running && stoppable);
}

size_t StressTestPanel::SplatCount() const {
	return static_cast<size_t>(m_splatCount->value());
}

void StressTestPanel::ShowSelectedDescription() {
	const int row = m_results->currentRow();
	const QTableWidgetItem* item = (row >= 0 && m_results->item(row, 0)) ? m_results->item(row, 0) : nullptr;
	//The explanation is stored as the row's tooltip, so the label and the tooltip always say the same thing
	m_description->setText(item && !item->toolTip().isEmpty() ? item->toolTip()
		: "Select a row to see what it measures. Double-click a total row to collapse or expand its test.");
	//The reason a step failed is drawn red as well
	const bool failed = item && item->data(Qt::UserRole).toBool();
	m_description->setStyleSheet(failed ? "color: #ff7b7b; font-weight: bold;" : QString());
}

void StressTestPanel::SetGroupCollapsed(int group, bool collapsed) {
	if (collapsed) {
		m_collapsedGroups.insert(group);
	}
	else {
		m_collapsedGroups.remove(group);
	}

	for (int row = 0; row < m_results->rowCount(); ++row) {
		QTableWidgetItem* first = m_results->item(row, 0);
		if (!first || first->data(kGroupRole).toInt() != group) {
			continue;
		}
		if (first->data(kTotalRole).toBool()) {
			first->setText(TotalLabel(first->data(kBaseNameRole).toString(), collapsed));
		}
		else {
			//A failed row stays visible, so a failure cannot hide behind a total
			const bool failed = first->data(Qt::UserRole).toBool();
			m_results->setRowHidden(row, collapsed && !failed);
		}
	}

	//A hidden row cannot stay selected, the description would be explaining something that is not on screen
	const int current = m_results->currentRow();
	if (current >= 0 && m_results->isRowHidden(current)) {
		m_results->clearSelection();
		m_results->setCurrentItem(nullptr);
	}
	ShowSelectedDescription();
}

void StressTestPanel::SetAllGroupsCollapsed(bool collapsed) {
	//Every group has exactly one total row
	QList<int> groups;
	for (int row = 0; row < m_results->rowCount(); ++row) {
		const QTableWidgetItem* first = m_results->item(row, 0);
		if (first && first->data(kTotalRole).toBool() && first->data(kGroupRole).toInt() >= 0) {
			groups.append(first->data(kGroupRole).toInt());
		}
	}
	for (int group : groups) {
		SetGroupCollapsed(group, collapsed);
	}
}

void StressTestPanel::AppendRow(const QString& name, const QString& splats, const QString& time, const QString& tooltip,
	const QBrush& color, bool bold, bool failed, int group, bool isTotal) {
	const int row = m_results->rowCount();
	m_results->insertRow(row);
	m_results->setItem(row, 0, new QTableWidgetItem(name));
	m_results->setItem(row, 1, new QTableWidgetItem(splats));
	m_results->setItem(row, 2, new QTableWidgetItem(time));
	m_results->item(row, 0)->setData(kGroupRole, group); //Always set, so a row never reads as group 0 by accident
	m_results->item(row, 0)->setData(kTotalRole, isTotal);
	//Same hover text and color on every cell of the row so it shows wherever the mouse is
	for (int column = 0; column < m_results->columnCount(); ++column) {
		QTableWidgetItem* cell = m_results->item(row, column);
		cell->setToolTip(tooltip);
		cell->setBackground(color);
		if (bold || failed) {
			QFont font = cell->font();
			font.setBold(true);
			cell->setFont(font);
		}
		if (failed) {
			cell->setForeground(QBrush(Qt::white));
			cell->setData(Qt::UserRole, true); //ShowSelectedDescription reads this
		}
	}
}

double StressTestPanel::AddResults(const std::vector<StressResult>& results, const QString& testName) {
	//A test keeps the same color for as long as the panel lives, even after Clear Results
	int testIndex = m_testNames.indexOf(testName);
	if (testIndex < 0) {
		m_testNames.append(testName);
		testIndex = static_cast<int>(m_testNames.size()) - 1;
	}
	const QBrush rowColor(kTestColors[testIndex % kTestColorCount]);

	//All the rows of this call, and their total row, are one group that can be collapsed together
	const int group = m_nextGroup++;

	const QLocale locale;
	double totalMs = 0.0;
	int failedInBatch = 0;
	for (const StressResult& result : results) {
		const QString splats = locale.toString(static_cast<qulonglong>(result.splatCount));
		if (result.ok) {
			AppendRow(result.name, splats, QString::number(result.ms, 'f', 2), result.tooltip, rowColor, false,
				false, group);
			totalMs += result.ms;
		}
		else {
			//A failed step has no time, it says FAILED instead of a number that could be read as a very fast result
			++failedInBatch;
			AppendRow(result.name + " (FAILED)", splats, "FAILED",
				QString("FAILED: %1\n\n%2").arg(result.note, result.tooltip), QBrush(kFailColor), true, true, group);
		}
	}

	//The splat count is left blank, the steps above do not all work on the same number of splats
	//%1 is a place holder like %i for ints in printf
	QString totalName = QString("%1: Total").arg(testName);
	QString totalTip = QString("All the timed steps of the %1 added together. Setup and clean-up are not timed, so this is less "
		"than how long the test took to run.").arg(testName);
	if (failedInBatch > 0) {
		totalName += QString(" (%1 failed)").arg(failedInBatch);
		totalTip += " Failed steps are not included, so this total is incomplete.";
	}
	totalTip += " Double-click this row to collapse or expand the steps above it.";
	//A total with a failed step is red, so it is noticed even while its rows are collapsed
	const QBrush totalColor = failedInBatch > 0 ? QBrush(kFailColor) : rowColor;
	AppendRow(TotalLabel(totalName, false), QString(), QString::number(totalMs, 'f', 2), totalTip, totalColor, true,
		false, group, true);
	m_results->item(m_results->rowCount() - 1, 0)->setData(kBaseNameRole, totalName); //So the arrow can change without losing the name

	if (failedInBatch > 0) {
		m_failedCount += failedInBatch;
		m_failureBanner->setText(QString("WARNING: %1 step(s) failed. See the red rows. Select a row to read the reason. "
			"The totals are incomplete.").arg(m_failedCount));
		m_failureBanner->setVisible(true);
	}

	//Failed rows stay visible even when collapsed, so a failure is never hidden by this
	if (kCollapseByDefault) {
		SetGroupCollapsed(group, true);
	}
	m_results->scrollToBottom();
	return totalMs;
}

void StressTestPanel::AddTotal(const QString& label, double ms, const QString& tooltip) {
	AppendRow(label, QString(), QString::number(ms, 'f', 2), tooltip, QBrush(QColor(0x55, 0x55, 0x5a)), true);
	m_results->scrollToBottom();
}
