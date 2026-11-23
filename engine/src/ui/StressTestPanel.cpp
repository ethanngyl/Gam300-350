#include "StressTestPanel.h"

#include <QBrush>
#include <QColor>
#include <QFont>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QLabel>
#include <QLocale>
#include <QPushButton>
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
	};
	constexpr int kTestColorCount = static_cast<int>(sizeof(kTestColors) / sizeof(kTestColors[0]));
}

StressTestPanel::StressTestPanel(QWidget* parent)
	: QWidget(parent)
{
	//Widgets must be heap allocated with a parent, a stack object is destroyed when the constructor returns
	//Layout manager
	auto* layout = new QVBoxLayout(this);

	auto* buttonRow = new QHBoxLayout();
	auto* testAllButton = new QPushButton("Test All", this);
	auto* loadTestButton = new QPushButton("Load Test", this);
	auto* selectTestButton = new QPushButton("Select Test", this);
	auto* moveTestButton = new QPushButton("Move Test", this);
	auto* deleteTestButton = new QPushButton("Delete Test", this);
	auto* undoRedoTestButton = new QPushButton("Undo/Redo Test", this);
	auto* clearButton = new QPushButton("Clear Results", this);
	buttonRow->addWidget(testAllButton);
	buttonRow->addWidget(loadTestButton);
	buttonRow->addWidget(selectTestButton);
	buttonRow->addWidget(moveTestButton);
	buttonRow->addWidget(deleteTestButton);
	buttonRow->addWidget(undoRedoTestButton);
	m_stopButton = new QPushButton("Stop", this);
	m_stopButton->setToolTip("Stops Test All after the test that is running finishes");
	m_stopButton->setEnabled(false); //Only usable during Test All
	buttonRow->addWidget(m_stopButton);
	buttonRow->addStretch(); //Keeps the buttons at their normal size instead of stretching across the dock
	buttonRow->addWidget(clearButton);
	m_runButtons = { testAllButton, loadTestButton, selectTestButton, moveTestButton, deleteTestButton,
		undoRedoTestButton, clearButton };
	layout->addLayout(buttonRow);

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
	connect(m_stopButton, &QPushButton::clicked, this, &StressTestPanel::stopRequested);
	connect(loadTestButton, &QPushButton::clicked, this, &StressTestPanel::loadTestRequested);
	connect(selectTestButton, &QPushButton::clicked, this, &StressTestPanel::selectTestRequested);
	connect(moveTestButton, &QPushButton::clicked, this, &StressTestPanel::moveTestRequested);
	connect(deleteTestButton, &QPushButton::clicked, this, &StressTestPanel::deleteTestRequested);
	connect(undoRedoTestButton, &QPushButton::clicked, this, &StressTestPanel::undoRedoTestRequested);
	connect(clearButton, &QPushButton::clicked, this, [this] {
		m_results->setRowCount(0);
		ShowSelectedDescription(); //Nothing is selected any more
	});
}

StressTestPanel::~StressTestPanel() = default;

void StressTestPanel::SetRunning(bool running, bool stoppable) {
	for (QPushButton* button : m_runButtons) {
		button->setEnabled(!running);
	}
	m_stopButton->setEnabled(running && stoppable);
}

void StressTestPanel::ShowSelectedDescription() {
	const int row = m_results->currentRow();
	const QTableWidgetItem* item = (row >= 0 && m_results->item(row, 0)) ? m_results->item(row, 0) : nullptr;
	//The explanation is stored as the row's tooltip, so the label and the tooltip always say the same thing
	m_description->setText(item && !item->toolTip().isEmpty() ? item->toolTip() : "Select a row to see what it measures.");
}

void StressTestPanel::AppendRow(const QString& name, const QString& splats, double ms, const QString& tooltip,
	const QBrush& color, bool bold) {
	const int row = m_results->rowCount();
	m_results->insertRow(row);
	m_results->setItem(row, 0, new QTableWidgetItem(name));
	m_results->setItem(row, 1, new QTableWidgetItem(splats));
	m_results->setItem(row, 2, new QTableWidgetItem(QString::number(ms, 'f', 2)));
	//Same hover text and color on every cell of the row so it shows wherever the mouse is
	for (int column = 0; column < m_results->columnCount(); ++column) {
		QTableWidgetItem* cell = m_results->item(row, column);
		cell->setToolTip(tooltip);
		cell->setBackground(color);
		if (bold) {
			QFont font = cell->font();
			font.setBold(true);
			cell->setFont(font);
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

	const QLocale locale;
	double totalMs = 0.0;
	for (const StressResult& result : results) {
		AppendRow(result.name, locale.toString(static_cast<qulonglong>(result.splatCount)), result.ms, result.tooltip,
			rowColor, false);
		totalMs += result.ms;
	}

	//The splat count is left blank, the steps above do not all work on the same number of splats
	//%1 is a place holder like %i for ints in printf
	AppendRow(QString("%1: Total").arg(testName), QString(), totalMs,
		QString("All the timed steps of the %1 added together. Setup and clean-up are not timed, so this is less "
			"than how long the test took to run.").arg(testName),
		rowColor, true);
	m_results->scrollToBottom();
	return totalMs;
}

void StressTestPanel::AddTotal(const QString& label, double ms, const QString& tooltip) {
	AppendRow(label, QString(), ms, tooltip, QBrush(QColor(0x55, 0x55, 0x5a)), true);
	m_results->scrollToBottom();
}
