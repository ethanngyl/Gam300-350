#include "StressTestPanel.h"

#include <QHBoxLayout>
#include <QHeaderView>
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
	auto* clearButton = new QPushButton("Clear Results", this);
	buttonRow->addWidget(testAllButton);
	buttonRow->addWidget(loadTestButton);
	buttonRow->addWidget(selectTestButton);
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

	connect(testAllButton, &QPushButton::clicked, this, [] {
		//Empty for now
	});
	connect(loadTestButton, &QPushButton::clicked, this, &StressTestPanel::loadTestRequested);
	connect(selectTestButton, &QPushButton::clicked, this, &StressTestPanel::selectTestRequested);
	connect(clearButton, &QPushButton::clicked, this, [this] { m_results->setRowCount(0); });
}

StressTestPanel::~StressTestPanel() = default;

void StressTestPanel::AddResults(const std::vector<StressResult>& results) {
	const QLocale locale;
	for (const StressResult& result : results) {
		const int row = m_results->rowCount();
		m_results->insertRow(row);
		m_results->setItem(row, 0, new QTableWidgetItem(result.name));
		m_results->setItem(row, 1, new QTableWidgetItem(locale.toString(static_cast<qulonglong>(result.splatCount))));
		m_results->setItem(row, 2, new QTableWidgetItem(QString::number(result.ms, 'f', 2)));
	}
	m_results->scrollToBottom();
}
