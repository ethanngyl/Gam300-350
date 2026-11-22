#include "StressTestPanel.h"

#include <QHBoxLayout>
#include <QHeaderView>
#include <QLabel>
#include <QLocale>
#include <QPushButton>
#include <QTableWidget>
#include <QVBoxLayout>

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
	auto* clearButton = new QPushButton("Clear Results", this);
	buttonRow->addWidget(testAllButton);
	buttonRow->addWidget(loadTestButton);
	buttonRow->addWidget(selectTestButton);
	buttonRow->addWidget(moveTestButton);
	buttonRow->addStretch(); //Keeps the buttons at their normal size instead of stretching across the dock
	buttonRow->addWidget(clearButton);
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
	connect(testAllButton, &QPushButton::clicked, this, [] {
		//Empty for now
	});
	connect(loadTestButton, &QPushButton::clicked, this, &StressTestPanel::loadTestRequested);
	connect(selectTestButton, &QPushButton::clicked, this, &StressTestPanel::selectTestRequested);
	connect(moveTestButton, &QPushButton::clicked, this, &StressTestPanel::moveTestRequested);
	connect(clearButton, &QPushButton::clicked, this, [this] {
		m_results->setRowCount(0);
		ShowSelectedDescription(); //Nothing is selected any more
	});
}

StressTestPanel::~StressTestPanel() = default;

void StressTestPanel::ShowSelectedDescription() {
	const int row = m_results->currentRow();
	const QTableWidgetItem* item = (row >= 0 && m_results->item(row, 0)) ? m_results->item(row, 0) : nullptr;
	//The explanation is stored as the row's tooltip, so the label and the tooltip always say the same thing
	m_description->setText(item && !item->toolTip().isEmpty() ? item->toolTip() : "Select a row to see what it measures.");
}

void StressTestPanel::AddResults(const std::vector<StressResult>& results) {
	const QLocale locale;
	for (const StressResult& result : results) {
		const int row = m_results->rowCount();
		m_results->insertRow(row);
		m_results->setItem(row, 0, new QTableWidgetItem(result.name));
		m_results->setItem(row, 1, new QTableWidgetItem(locale.toString(static_cast<qulonglong>(result.splatCount))));
		m_results->setItem(row, 2, new QTableWidgetItem(QString::number(result.ms, 'f', 2)));
		//Same hover text on every cell of the row so it shows wherever the mouse is
		for (int column = 0; column < m_results->columnCount(); ++column) {
			m_results->item(row, column)->setToolTip(result.tooltip);
		}
	}
	m_results->scrollToBottom();
}
